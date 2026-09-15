import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/admin-api\/?/, "");
    const method = req.method;

    // Route: POST /bootstrap — one-time super-admin setup (no auth required)
    if (path === "bootstrap" && method === "POST") {
      const { email, password, name } = await req.json();
      if (!email || !password) {
        return new Response(JSON.stringify({ error: "Email and password required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      // Check if any super_admin already exists
      const { data: existing } = await adminClient
        .from("profiles")
        .select("id")
        .eq("role", "super_admin")
        .limit(1);

      if (existing && existing.length > 0) {
        return new Response(JSON.stringify({ error: "Super admin already exists. Contact your administrator." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create the auth user
      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: name || "Super Admin" },
      });

      if (createErr || !newUser.user) {
        return new Response(JSON.stringify({ error: createErr?.message || "Failed to create user" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update profile to super_admin
      await adminClient
        .from("profiles")
        .update({ role: "super_admin", name: name || "Super Admin" })
        .eq("id", newUser.user.id);

      return new Response(JSON.stringify({ success: true, message: "Super admin created successfully" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All routes below require authentication
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
      },
    );

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = authData.user.id;
    const callerEmail = authData.user.email;

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role, status, name, permissions")
      .eq("id", callerId)
      .maybeSingle();

    if (!callerProfile || callerProfile.status !== "active") {
      return new Response(JSON.stringify({ error: "Account disabled" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isSuperAdmin = callerProfile.role === "super_admin";
    const isAdmin = callerProfile.role === "admin" || isSuperAdmin;
    const hasPerm = (p: string) => isSuperAdmin || (callerProfile.permissions || []).includes(p);

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper: log audit
    const logAudit = async (action: string, entityType: string, entityId: string | null, details: Record<string, unknown>) => {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await adminClient.from("audit_logs").insert({
        admin_id: callerId,
        admin_name: callerProfile.name || callerEmail,
        action,
        entity_type: entityType,
        entity_id: entityId,
        details,
      });
    };

    // Route: POST /create-admin — super_admin creates a new admin account
    if (path === "create-admin" && method === "POST") {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: "Super admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { email, password, name, permissions } = await req.json();
      if (!email || !password) {
        return new Response(JSON.stringify({ error: "Email and password required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });

      if (createErr || !newUser.user) {
        return new Response(JSON.stringify({ error: createErr?.message || "Failed to create admin" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await adminClient
        .from("profiles")
        .update({ role: "admin", name, permissions: permissions || [] })
        .eq("id", newUser.user.id);

      await logAudit("create_admin", "user", newUser.user.id, { email, name, permissions });

      return new Response(JSON.stringify({ success: true, id: newUser.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Route: DELETE /delete-auth-user — delete a user's auth account (service role)
    if (path === "delete-auth-user" && method === "POST") {
      const { userId, role } = await req.json();
      if (!userId) {
        return new Response(JSON.stringify({ error: "User ID required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Permission check
      if (role === "admin" || role === "super_admin") {
        if (!isSuperAdmin) {
          return new Response(JSON.stringify({ error: "Super admin required to delete admins" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        if (!hasPerm("can-manage-users")) {
          return new Response(JSON.stringify({ error: "can-manage-users permission required" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      if (userId === callerId) {
        return new Response(JSON.stringify({ error: "Cannot delete your own account" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await logAudit("delete_user", "user", userId, { role });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Route: GET /review-attempt — super_admin gets full attempt details with answers
    if (path === "review-attempt" && method === "GET") {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: "Super admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const attemptId = url.searchParams.get("id");
      if (!attemptId) {
        return new Response(JSON.stringify({ error: "Attempt ID required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      // Get the attempt
      const { data: attempt, error: attemptErr } = await adminClient
        .from("attempts")
        .select("*")
        .eq("id", attemptId)
        .maybeSingle();

      if (attemptErr || !attempt) {
        return new Response(JSON.stringify({ error: "Attempt not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get test title
      const { data: test } = await adminClient
        .from("tests")
        .select("title, pass_mark")
        .eq("id", attempt.test_id)
        .maybeSingle();

      // Get candidate name and email
      const { data: candidateUser } = await adminClient.auth.admin.getUserById(attempt.candidate_id);
      const { data: candidateProfile } = await adminClient
        .from("profiles")
        .select("name")
        .eq("id", attempt.candidate_id)
        .maybeSingle();

      // Get all sections, questions, and options for this test
      const { data: sections } = await adminClient
        .from("sections")
        .select("*")
        .eq("test_id", attempt.test_id)
        .order("order_index", { ascending: true });

      const sectionIds = (sections || []).map((s: { id: string }) => s.id);
      let questions: Record<string, unknown>[] = [];
      let options: Record<string, unknown>[] = [];
      let links: Record<string, unknown>[] = [];
      if (sectionIds.length > 0) {
        const { data: questionsData } = await adminClient
          .from("questions")
          .select("*")
          .in("section_id", sectionIds)
          .order("order_index", { ascending: true });
        questions = (questionsData || []) as Record<string, unknown>[];

        const questionIds = questions.map((q) => q.id as string);
        if (questionIds.length > 0) {
          const { data: optionsData } = await adminClient
            .from("options")
            .select("*")
            .in("question_id", questionIds);
          options = (optionsData || []) as Record<string, unknown>[];

          const { data: linksData } = await adminClient
            .from("question_links")
            .select("*")
            .in("question_id", questionIds)
            .order("order_index", { ascending: true });
          links = (linksData || []) as Record<string, unknown>[];
        }
      }

      // Mark as reviewed if pending
      if (attempt.review_status === "pending_review") {
        await adminClient.from("attempts").update({ review_status: "reviewed" }).eq("id", attemptId);
      }

      return new Response(JSON.stringify({
        attempt: { ...attempt, review_status: attempt.review_status === "pending_review" ? "reviewed" : attempt.review_status },
        test_title: test?.title || "Unknown",
        pass_mark: test?.pass_mark || 70,
        candidate_name: candidateProfile?.name || "Unknown",
        candidate_email: candidateUser?.user?.email || "",
        sections: sections || [],
        questions,
        options,
        links,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Route: POST /release-attempt — super_admin releases score to candidate + sends email
    if (path === "release-attempt" && method === "POST") {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: "Super admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { attemptId, adminNotes, grantRetake, retakeCount } = await req.json();
      if (!attemptId) {
        return new Response(JSON.stringify({ error: "Attempt ID required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      // Get the attempt
      const { data: attempt, error: attemptErr } = await adminClient
        .from("attempts")
        .select("*")
        .eq("id", attemptId)
        .maybeSingle();

      if (attemptErr || !attempt) {
        return new Response(JSON.stringify({ error: "Attempt not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get candidate email and test title
      const { data: candidateUser } = await adminClient.auth.admin.getUserById(attempt.candidate_id);
      const { data: candidateProfile } = await adminClient
        .from("profiles")
        .select("name")
        .eq("id", attempt.candidate_id)
        .maybeSingle();
      const { data: test } = await adminClient
        .from("tests")
        .select("title")
        .eq("id", attempt.test_id)
        .maybeSingle();

      const candidateEmail = candidateUser?.user?.email || "";
      const candidateName = candidateProfile?.name || "Candidate";
      const testTitle = test?.title || "Certification Exam";

      // Release the score
      const { error: releaseErr } = await adminClient
        .from("attempts")
        .update({
          review_status: "released",
          released_at: new Date().toISOString(),
          released_by: callerId,
          admin_notes: adminNotes || "",
        })
        .eq("id", attemptId);

      if (releaseErr) {
        return new Response(JSON.stringify({ error: releaseErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Optionally grant retake with count
      if (grantRetake) {
        await adminClient
          .from("test_unlocks")
          .upsert({
            candidate_id: attempt.candidate_id,
            test_id: attempt.test_id,
            unlocked_by: callerId,
            retakes_allowed: retakeCount || 1,
            retakes_used: 0,
          }, { onConflict: "candidate_id,test_id" });
      }

      // Store in-app notification for candidate
      await adminClient.from("notifications").insert({
        user_id: attempt.candidate_id,
        type: "result_released",
        title: `Results Available: ${testTitle}`,
        message: `Your score for ${testTitle} is ${attempt.score}% (${attempt.pass_or_fail === "pass" ? "Passed" : "Did Not Pass"}).${grantRetake ? ` You have been granted ${retakeCount || 1} retake(s) for this test.` : ""}${adminNotes ? ` Admin notes: ${adminNotes}` : ""}`,
      });

      // Send email notification to candidate via Resend if API key is configured
      let emailSent = false;
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (candidateEmail && resendApiKey) {
        try {
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #1e40af; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px;">Rater X</h1>
                <p style="color: #bfdbfe; margin: 4px 0 0;">Your Assessment Results Are Ready</p>
              </div>
              <div style="background: white; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="color: #334155; font-size: 16px;">Hello ${candidateName},</p>
                <p style="color: #475569; font-size: 15px; line-height: 1.6;">
                  Your results for <strong>${testTitle}</strong> have been reviewed and released by the administrator.
                </p>
                <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                  <p style="font-size: 36px; font-weight: bold; color: ${attempt.pass_or_fail === "pass" ? "#16a34a" : "#dc2626"}; margin: 0;">
                    ${attempt.score}%
                  </p>
                  <p style="color: #64748b; margin: 4px 0 0;">${attempt.correct_answers} out of ${attempt.total_questions} correct</p>
                  <p style="font-size: 18px; font-weight: bold; color: ${attempt.pass_or_fail === "pass" ? "#16a34a" : "#dc2626"}; margin: 8px 0 0;">
                    ${attempt.pass_or_fail === "pass" ? "PASSED" : "Did Not Pass"}
                  </p>
                </div>
                ${adminNotes ? `<div style="background: #fefce8; border-left: 4px solid #ca8a04; padding: 12px 16px; margin: 16px 0; border-radius: 4px;"><p style="color: #713f12; margin: 0; font-size: 14px;"><strong>Admin Notes:</strong> ${adminNotes}</p></div>` : ""}
                <p style="color: #475569; font-size: 14px; line-height: 1.6;">
                  Please log in to your Rater X account to view your detailed results.${grantRetake ? ` You have been granted ${retakeCount || 1} retake(s) for this test.` : ""}
                </p>
                <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 24px;">This is an automated message from Rater X. Please do not reply to this email.</p>
              </div>
            </div>
          `;

          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Rater X <notifications@raterx.app>",
              to: [candidateEmail],
              subject: `Your ${testTitle} Results Are Ready`,
              html: emailHtml,
            }),
          });
          emailSent = emailRes.ok;
        } catch (emailErr) {
          console.error("Email send error:", emailErr);
        }
      }

      await logAudit("release_attempt", "attempt", attemptId, {
        candidate_email: candidateEmail,
        test_title: testTitle,
        score: attempt.score,
        grant_retake: !!grantRetake,
        admin_notes: adminNotes || "",
      });

      return new Response(JSON.stringify({
        success: true,
        candidate_email: candidateEmail,
        candidate_name: candidateName,
        test_title: testTitle,
        score: attempt.score,
        pass_or_fail: attempt.pass_or_fail,
        correct_answers: attempt.correct_answers,
        total_questions: attempt.total_questions,
        email_sent: emailSent,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Route: POST /grant-retake — super_admin grants retake to a candidate
    if (path === "grant-retake" && method === "POST") {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: "Super admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { candidateId, testId, retakeCount: grantRetakeCount } = await req.json();
      if (!candidateId || !testId) {
        return new Response(JSON.stringify({ error: "Candidate ID and Test ID required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      await adminClient
        .from("test_unlocks")
        .upsert({
          candidate_id: candidateId,
          test_id: testId,
          unlocked_by: callerId,
          retakes_allowed: grantRetakeCount || 1,
          retakes_used: 0,
        }, { onConflict: "candidate_id,test_id" });

      await logAudit("grant_retake", "test", testId, { candidate_id: candidateId });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
