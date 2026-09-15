import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await anonClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userEmail = user.email;
    if (!userEmail) {
      return jsonResponse({ error: "No email address found" }, 400);
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: code, error: rpcError } = await adminClient.rpc(
      "create_verification_code",
      { p_user_id: user.id }
    );

    if (rpcError || !code) {
      console.error("create_verification_code failed:", rpcError?.message);
      return jsonResponse(
        { error: "Failed to generate verification code" },
        500
      );
    }

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
        <div style="background: #1e3a5f; padding: 28px 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">
            Rater X
          </h1>
          <p style="color: #93b4d4; margin: 6px 0 0; font-size: 13px;">Evaluation Hub</p>
        </div>
        <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #334155; font-size: 15px; margin: 0 0 16px; line-height: 1.5;">
            Enter this code to verify your email address. It expires in 10 minutes.
          </p>
          <div style="background: #f1f5f9; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 20px;">
            <span style="font-size: 32px; font-weight: 700; color: #1e3a5f; letter-spacing: 8px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;">
              ${code}
            </span>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin: 0; line-height: 1.5;">
            If you didn't request this code, you can safely ignore this email.
          </p>
        </div>
        <div style="padding: 16px 24px; text-align: center; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; background: #f8fafc;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">&copy; Rater X Evaluation Hub</p>
        </div>
      </div>
    `;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not configured");
      return jsonResponse(
        { error: "Email delivery is not configured. Please contact the administrator." },
        503
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:
          Deno.env.get("RESEND_FROM_EMAIL") ||
          "Rater X <onboarding@resend.dev>",
        to: [userEmail],
        subject: "Your Rater X Verification Code",
        html: emailHtml,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend error:", errText);
      return jsonResponse(
        { error: "Failed to send verification email. Please try again." },
        502
      );
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("send-verification-code error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
