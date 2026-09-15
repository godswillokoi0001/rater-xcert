import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

const SUPER_ADMIN_EMAIL = "godlestatios@outlook.com";

function buildTestSubmittedEmail(data: {
  candidateName: string;
  candidateEmail: string;
  testTitle: string;
}) {
  return {
    subject: `New Test Submission: ${data.testTitle}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto;">
        <div style="background: #1e3a5f; padding: 28px 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700;">Rater X</h1>
          <p style="color: #93b4d4; margin: 6px 0 0; font-size: 13px;">New Submission Requires Review</p>
        </div>
        <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #334155; font-size: 15px; margin: 0 0 20px; line-height: 1.5;">
            A candidate has submitted a test that requires your review.
          </p>
          <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px;">
            <tr>
              <td style="padding: 10px 12px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Candidate</td>
              <td style="padding: 10px 12px; color: #1e293b; font-size: 14px; font-weight: 600; border-bottom: 1px solid #f1f5f9; text-align: right;">${data.candidateName}</td>
            </tr>
            <tr>
              <td style="padding: 10px 12px; color: #64748b; font-size: 13px; border-bottom: 1px solid #f1f5f9;">Email</td>
              <td style="padding: 10px 12px; color: #1e293b; font-size: 14px; border-bottom: 1px solid #f1f5f9; text-align: right;">${data.candidateEmail}</td>
            </tr>
            <tr>
              <td style="padding: 10px 12px; color: #64748b; font-size: 13px;">Test</td>
              <td style="padding: 10px 12px; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${data.testTitle}</td>
            </tr>
          </table>
          <div style="text-align: center;">
            <p style="color: #64748b; font-size: 13px; margin: 0;">
              Log in to the Rater X admin panel to review and release the results.
            </p>
          </div>
        </div>
        <div style="padding: 16px 24px; text-align: center; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; background: #f8fafc;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">This is an automated message from Rater X. Please do not reply.</p>
        </div>
      </div>
    `,
  };
}

function buildResultReleasedEmail(data: {
  candidateName: string;
  testTitle: string;
  score: number;
  passOrFail: string;
  correctAnswers: number;
  totalQuestions: number;
  adminNotes?: string;
  grantRetake?: boolean;
  retakeCount?: number;
}) {
  const passed = data.passOrFail === "pass";
  const scoreColor = passed ? "#16a34a" : "#dc2626";
  const scoreBg = passed ? "#f0fdf4" : "#fef2f2";

  return {
    subject: `Your Results: ${data.testTitle}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto;">
        <div style="background: #1e3a5f; padding: 28px 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700;">Rater X</h1>
          <p style="color: #93b4d4; margin: 6px 0 0; font-size: 13px;">Your Assessment Results Are Ready</p>
        </div>
        <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #334155; font-size: 15px; margin: 0 0 8px; line-height: 1.5;">
            Hi ${data.candidateName},
          </p>
          <p style="color: #334155; font-size: 15px; margin: 0 0 20px; line-height: 1.5;">
            Your results for <strong>${data.testTitle}</strong> have been reviewed and released.
          </p>
          
          <div style="background: ${scoreBg}; border-radius: 12px; padding: 24px; text-align: center; margin: 0 0 20px;">
            <p style="font-size: 48px; font-weight: 800; color: ${scoreColor}; margin: 0; line-height: 1;">${data.score}%</p>
            <p style="color: ${scoreColor}; font-size: 16px; font-weight: 600; margin: 8px 0 4px;">${passed ? "PASSED" : "DID NOT PASS"}</p>
            <p style="color: #64748b; font-size: 13px; margin: 0;">${data.correctAnswers} of ${data.totalQuestions} correct</p>
          </div>

          ${data.adminNotes ? `
          <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 0 0 20px; border-left: 3px solid #3b82f6;">
            <p style="color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px;">Admin Notes</p>
            <p style="color: #334155; font-size: 14px; margin: 0; line-height: 1.5;">${data.adminNotes}</p>
          </div>
          ` : ""}

          ${data.grantRetake ? `
          <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 0 0 20px; border-left: 3px solid #16a34a;">
            <p style="color: #16a34a; font-size: 14px; font-weight: 600; margin: 0;">
              You have been granted ${data.retakeCount || 1} retake(s) for this test.
            </p>
            <p style="color: #64748b; font-size: 13px; margin: 6px 0 0;">Log in to your dashboard to retake the test when you are ready.</p>
          </div>
          ` : ""}

          <div style="text-align: center;">
            <p style="color: #64748b; font-size: 13px; margin: 0;">
              Log in to your Rater X account to view your detailed results.
            </p>
          </div>
        </div>
        <div style="padding: 16px 24px; text-align: center; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; background: #f8fafc;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">This is an automated message from Rater X. Please do not reply.</p>
        </div>
      </div>
    `,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { type } = body;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY not configured");
      return jsonResponse({ error: "Email not configured" }, 503);
    }

    const fromEmail =
      Deno.env.get("RESEND_FROM_EMAIL") || "Rater X <onboarding@resend.dev>";

    let toEmail: string;
    let emailContent: { subject: string; html: string };

    if (type === "test_submitted") {
      toEmail = SUPER_ADMIN_EMAIL;
      emailContent = buildTestSubmittedEmail({
        candidateName: body.candidateName || "Unknown",
        candidateEmail: body.candidateEmail || "Unknown",
        testTitle: body.testTitle || "Unknown Test",
      });
    } else if (type === "result_released") {
      toEmail = body.candidateEmail;
      if (!toEmail) {
        return jsonResponse({ error: "candidateEmail required" }, 400);
      }
      emailContent = buildResultReleasedEmail({
        candidateName: body.candidateName || "Candidate",
        testTitle: body.testTitle || "Unknown Test",
        score: body.score ?? 0,
        passOrFail: body.passOrFail || "fail",
        correctAnswers: body.correctAnswers ?? 0,
        totalQuestions: body.totalQuestions ?? 0,
        adminNotes: body.adminNotes,
        grantRetake: body.grantRetake,
        retakeCount: body.retakeCount,
      });
    } else {
      return jsonResponse({ error: "Invalid email type" }, 400);
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: emailContent.subject,
        html: emailContent.html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend API error:", errText);
      return jsonResponse({ error: "Failed to send email" }, 502);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("send-notification-email error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
