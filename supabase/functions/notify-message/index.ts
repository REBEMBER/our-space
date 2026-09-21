import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:ourspace@example.com";

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response("Unauthorized", {
        status: 401,
        headers: corsHeaders
      });
    }

    const { data: userData, error: userError } =
      await admin.auth.getUser(token);

    if (userError || !userData.user) {
      return new Response("Unauthorized", {
        status: 401,
        headers: corsHeaders
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

    if (sender_id !== userData.user.id) {
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders
      });
    }

    const { data: message, error: messageError } = await admin
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

    if (membersError) {
      throw membersError;
    }

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

    if (subscriptionError) {
      throw subscriptionError;
    }

    const senderName =
      userData.user.user_metadata?.display_name ||
      userData.user.user_metadata?.name ||
      "Our Space";

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
