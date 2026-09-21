import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function getSecret(name: string) {
  const { data, error } = await admin.rpc("get_push_secret", { p_name: name });
  if (error) throw error;
  return data as string | null;
}

async function ensureVapidKeys() {
  let publicKey = await getSecret("our_space_vapid_public");
  let privateKey = await getSecret("our_space_vapid_private");
  let subject = await getSecret("our_space_vapid_subject");

  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;

    await admin.rpc("set_push_secret", {
      p_name: "our_space_vapid_public",
      p_value: publicKey
    });
    await admin.rpc("set_push_secret", {
      p_name: "our_space_vapid_private",
      p_value: privateKey
    });
  }

  if (!subject) {
    subject = "mailto:ourspace@example.com";
    await admin.rpc("set_push_secret", {
      p_name: "our_space_vapid_subject",
      p_value: subject
    });
  }

  return { publicKey, privateKey, subject };
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return new Response("Unauthorized", {
        status: 401,
        headers: corsHeaders
      });
    }

    const vapid = await ensureVapidKeys();

    if (req.method === "GET") {
      return new Response(JSON.stringify({ publicKey: vapid.publicKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const { message_id, space_id, sender_id, content } = body;

    if (!message_id || !space_id || !sender_id) {
      return new Response("Missing message data", {
        status: 400,
        headers: corsHeaders
      });
    }

    if (sender_id !== user.id) {
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders
      });
    }

    const { data: message, error: messageError } =
      await admin
        .from("messages")
        .select("id, space_id, sender_id, content")
        .eq("id", message_id)
        .eq("space_id", space_id)
        .eq("sender_id", sender_id)
        .maybeSingle();

    if (messageError || !message) {
      return new Response("Message not found", {
        status: 404,
        headers: corsHeaders
      });
    }

    const { data: members, error: membersError } = await admin
      .from("space_members")
      .select("user_id")
      .eq("space_id", space_id)
      .neq("user_id", sender_id);

    if (membersError) throw membersError;

    const recipientIds = (members || []).map((row) => row.user_id);
    if (!recipientIds.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: subscriptions, error: subscriptionError } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, subscription, preview_enabled")
      .in("user_id", recipientIds);

    if (subscriptionError) throw subscriptionError;

    const senderName =
      user.user_metadata?.display_name ||
      user.user_metadata?.name ||
      "Our Space";

    webpush.setVapidDetails(
      vapid.subject,
      vapid.publicKey,
      vapid.privateKey
    );

    let sent = 0;

    for (const row of subscriptions || []) {
      try {
        const previewEnabled = row.preview_enabled !== false;

        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({
            message_id,
            preview_enabled: previewEnabled,
            sender_name: senderName,
            content: previewEnabled ? (content || message.content || "") : ""
          })
        );

        sent++;
      } catch (error) {
        const statusCode = error?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("id", row.id);
        } else {
          console.error("Push send failed:", error);
        }
      }
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: "Notification send failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
