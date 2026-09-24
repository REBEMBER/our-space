import { withSupabase } from "npm:@supabase/server";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const CATEGORIES=["appreciation","memories","future","connection","communication","playful","everyday","discovery","gratitude","growth","dates","little-things"];
const FALLBACK=[
["appreciation","What is one small thing your partner did recently that made you feel especially appreciated?"],
["memories","What is a simple memory of the two of you that still makes you smile when you think about it?"],
["future","What is one experience you would genuinely love for the two of you to share in the next year?"],
["playful","If you had to plan a completely spontaneous date for tonight, what would you choose?"],
["connection","What kind of ordinary moment makes you feel closest to your partner?"],
["communication","What is something your partner does that makes you feel truly listened to?"],
["everyday","What is one little thing you enjoy doing together more than you probably admit?"],
["discovery","What is something about your partner that you understand better now than you did at first?"],
["gratitude","What is something about your relationship that you feel grateful for today?"],
["growth","What is one way you think the two of you have grown together?"],
["dates","What would your ideal low-budget date with your partner look like?"],
["little-things","What tiny gesture from your partner can change the mood of your whole day?"],
["appreciation","What quality in your partner do you hope they never underestimate?"],
["memories","Which early moment in your relationship do you wish you could watch again?"],
["future","What is one place you would love to wake up with your partner someday?"],
["playful","What silly activity would the two of you probably have way too much fun doing together?"],
["connection","When do you feel most comfortable being completely yourself with your partner?"],
["communication","What is one thing you wish people understood about how the two of you communicate?"],
["everyday","What part of an ordinary day is better simply because your partner is in it?"],
["discovery","What is something your partner has taught you without trying to teach you?"],
["gratitude","What part of your partner's personality do you feel lucky to experience up close?"],
["growth","What is one habit you would love for the two of you to build together?"],
["dates","What kind of date would feel completely new for the two of you?"],
["little-things","What is one tiny shared routine you would miss if it disappeared?"]
];

const out=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const today=()=>{
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"Africa/Casablanca",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const get=(type:string)=>parts.find(part=>part.type===type)?.value||"";
  return get("year")+"-"+get("month")+"-"+get("day");
};
const norm=(s:string)=>String(s||"").toLowerCase().replace(/[^a-z0-9\\s]/g," ").replace(/\\s+/g," ").trim();
const similar=(a:string,b:string)=>{
  const A=new Set(norm(a).split(" ").filter(x=>x.length>2)),B=new Set(norm(b).split(" ").filter(x=>x.length>2));
  if(!A.size||!B.size)return 0; let n=0; for(const x of A)if(B.has(x))n++; return n/Math.max(A.size,B.size);
};
const duplicate=(q:string,h:any[])=>h.some(x=>norm(x.question)===norm(q)||similar(q,x.question)>=.82);
const fallback=(h:any[],date:string)=>{
  const unused=FALLBACK.filter(x=>!duplicate(x[1],h)); const pool=unused.length?unused:FALLBACK;
  const i=Math.abs(Math.floor(Date.parse(date+"T00:00:00Z")/86400000))%pool.length;
  return {category:pool[i][0],question:pool[i][1],model:"fallback"};
};

async function ai(apiKey:string,h:any[],date:string){
  const used=h.slice(-80).map(x=>"- "+x.question).join("\n");
  const prompt=[
    "Create one daily relationship question for two adults in a private couples app.",
    "Warm, natural, concise, conversation-worthy; answers should differ naturally between partners.",
    "Rotate affection, memories, future, everyday life, communication, discovery, growth, playful prompts and dates.",
    "Never therapy homework, interview style, sexual content, passwords, financial secrets, identifying data, loyalty tests, jealousy traps, manipulation, breakup scenarios or comparisons.",
    "Never repeat or lightly rephrase a previous question.",
    "Return ONLY JSON {question,category}. category must be one of: "+CATEGORIES.join(", ")+".",
    "Question: one sentence, 18-240 characters, ending in ?. Previous questions:\n"+(used||"- none"),
    "Today's date: "+date
  ].join("\n");
  try{
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",{
      method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},
      body:JSON.stringify({system_instruction:{parts:[{text:prompt}]},contents:[{role:"user",parts:[{text:"Generate it now."}]}],generationConfig:{temperature:.85,maxOutputTokens:160,candidateCount:1,responseMimeType:"application/json"}}),
      signal:AbortSignal.timeout(2200)
    });
    if(!r.ok)return null;
    const d=await r.json().catch(()=>null),raw=(d?.candidates?.[0]?.content?.parts||[]).map((p:any)=>String(p?.text||"")).join("").trim(),v=JSON.parse(raw);
    const q=String(v?.question||"").replace(/\\s+/g," ").trim(),cat=String(v?.category||"").toLowerCase();
    if(q.length<18||q.length>240||!q.endsWith("?")||!CATEGORIES.includes(cat)||duplicate(q,h))return null;
    return {question:q,category:cat,model:"gemini-3.8-flash"};
  }catch{return null}
}

export default {fetch:withSupabase({auth:"user"},async(req,ctx)=>{
  if(req.method==="OPTIONS")return new Response("ok",{status:200,headers:corsHeaders});
  if(req.method!=="POST")return out({error:"Method not allowed."},405);
  try{
    const body=await req.json().catch(()=>({})),spaceId=String(body?.space_id||""),userId=String(ctx.userClaims?.id||ctx.jwtClaims?.sub||"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(spaceId)||!userId)return out({error:"A valid authenticated space is required."},400);
    const m=await ctx.supabaseAdmin.from("space_members").select("space_id").eq("space_id",spaceId).eq("user_id",userId).maybeSingle();
    if(m.error)return out({error:"Could not verify your couple space."},500);
    if(!m.data)return out({error:"You are not a member of this space."},403);
    const date=today();
    const existing=await ctx.supabaseAdmin.from("daily_questions").select("id,space_id,question_date,question,category,difficulty,ai_model,created_at").eq("space_id",spaceId).eq("question_date",date).maybeSingle();
    if(existing.error)return out({error:"Could not load today's question."},500);
    if(existing.data)return out({question:existing.data,reused:true,source:"database"});
    const history=await ctx.supabaseAdmin.from("daily_questions").select("question,category,question_date").eq("space_id",spaceId).order("question_date",{ascending:false}).limit(80);
    if(history.error)return out({error:"Could not load question history."},500);
    const h=(history.data||[]).reverse(),generated=Deno.env.get("GEMINI_API_KEY")?((await ai(Deno.env.get("GEMINI_API_KEY")!,h,date))||fallback(h,date)):fallback(h,date);
    const inserted=await ctx.supabaseAdmin.from("daily_questions").insert({space_id:spaceId,question_date:date,question:generated.question,category:generated.category,difficulty:"medium",ai_model:generated.model}).select("id,space_id,question_date,question,category,difficulty,ai_model,created_at").single();
    if(inserted.error){
      const raced=await ctx.supabaseAdmin.from("daily_questions").select("id,space_id,question_date,question,category,difficulty,ai_model,created_at").eq("space_id",spaceId).eq("question_date",date).maybeSingle();
      if(raced.data)return out({question:raced.data,reused:true,source:"race-recovery"});
      return out({error:"Could not save today's question."},500);
    }
    return out({question:inserted.data,reused:false,source:generated.model==="fallback"?"deterministic-fallback":"ai"});
  }catch(e){console.error("daily-question",e);return out({error:"The daily question service is temporarily unavailable."},500);}
})};