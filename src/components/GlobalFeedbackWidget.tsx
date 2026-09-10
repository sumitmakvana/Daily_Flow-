import React, { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitDemoFeedback, type DemoFeedbackData } from "@/services/demo-feedback.functions";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { X, MessageSquarePlus, Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function GlobalFeedbackWidget() {
  const { user, isManager } = useAuth();
  const submitDemoFeedbackFn = useServerFn(submitDemoFeedback);

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<"rating" | "details" | "thankyou">("rating");
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [category, setCategory] = useState<string>("");
  const [detailedFeedback, setDetailedFeedback] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-open timer on initial app visit if feedback not yet submitted
  useEffect(() => {
    const hasSubmitted = localStorage.getItem("daily_flow_feedback_submitted");
    const dismissTimestamp = localStorage.getItem("daily_flow_feedback_dismissed");
    
    // Only auto-open if user hasn't submitted and hasn't dismissed in the last 24h
    if (!hasSubmitted) {
      if (!dismissTimestamp || Date.now() - Number(dismissTimestamp) > 24 * 60 * 60 * 1000) {
        const timer = setTimeout(() => {
          setIsOpen(true);
        }, 5000); // 5 seconds after load
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    localStorage.setItem("daily_flow_feedback_dismissed", Date.now().toString());
  };

  const handleSelectRating = (rating: number) => {
    setSelectedRating(rating);
    setStep("details");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRating) return;

    setIsSubmitting(true);
    try {
      const userEmail = user?.email || user?.user_metadata?.email || "anonymous";
      const payload: DemoFeedbackData = {
        session_id: `global_app_feedback_${Date.now()}`,
        user_email: userEmail,
        user_role: isManager ? "manager" : "member",
        step_reached: 4,
        my_day_capacity_hours: 8.0,
        tasks_interacted_count: 1,
        eod_submitted: true,
        is_useful: selectedRating >= 4 ? "yes" : selectedRating === 3 ? "partially" : "no",
        overall_rating: selectedRating,
        ratings_json: {
          satisfaction: selectedRating,
        },
        most_liked_feature: category || "General Experience",
        improvement_suggestions: category || undefined,
        detailed_feedback: detailedFeedback.trim() || `User rated ${selectedRating}/5 stars.`,
      };

      await submitDemoFeedbackFn({ data: payload });

      // Save locally as fallback/history
      const localLogs = JSON.parse(localStorage.getItem("daily_flow_demo_feedback_logs") || "[]");
      localLogs.unshift({ ...payload, completed_at: new Date().toISOString() });
      localStorage.setItem("daily_flow_demo_feedback_logs", JSON.stringify(localLogs));
      localStorage.setItem("daily_flow_feedback_submitted", "true");

      setStep("thankyou");

      // Auto close after 3 seconds
      setTimeout(() => {
        setIsOpen(false);
        // Reset state for next time if re-opened
        setStep("rating");
        setSelectedRating(null);
        setCategory("");
        setDetailedFeedback("");
      }, 3000);
    } catch (err) {
      console.warn("Feedback submission fallback:", err);
      toast.success("Thank you for your feedback!");
      setStep("thankyou");
      setTimeout(() => {
        setIsOpen(false);
        setStep("rating");
      }, 3000);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* 1. Minimized / Floating Trigger Button (Bottom Right) */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 bg-[#18191d] hover:bg-[#222329] text-slate-200 border border-[#2b2c34] px-3.5 py-2 rounded-full shadow-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95 group cursor-pointer"
          title="Give App Feedback"
        >
          <MessageSquarePlus className="h-4 w-4 text-[#5C8EFA] group-hover:scale-110 transition-transform" />
          <span>Feedback</span>
        </button>
      )}

      {/* 2. Expanded Floating Feedback Widget Modal Card */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-[320px] sm:w-[360px] bg-[#18191d] border border-[#2b2c34] rounded-xl shadow-2xl overflow-hidden p-4 text-slate-100 animate-in fade-in slide-in-from-bottom-3 duration-200">
          {/* Header Close Button */}
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-3.5 right-3.5 text-slate-400 hover:text-white p-1 rounded-md hover:bg-[#25262c] transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>

          {/* STEP 1: RATING SELECTION */}
          {step === "rating" && (
            <div className="space-y-4 pr-6">
              <div>
                <h4 className="text-sm font-semibold text-slate-100 leading-snug">
                  How satisfied are you with <span className="text-white font-bold">Operon</span> overall?
                </h4>
              </div>

              {/* Rating Buttons 1 to 5 */}
              <div className="grid grid-cols-5 gap-2 pt-1">
                {[1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleSelectRating(num)}
                    className={cn(
                      "h-10 border border-[#2b2c34] bg-[#222329] hover:bg-[#2e3038] hover:border-slate-400 rounded-lg text-sm font-bold text-slate-200 transition-all flex items-center justify-center cursor-pointer active:scale-95 shadow-xs",
                      selectedRating === num && "border-[#5C8EFA] bg-[#5C8EFA]/20 text-[#5C8EFA]"
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>

              {/* Rating Scale Labels */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium px-0.5">
                <span>Very dissatisfied</span>
                <span>Very satisfied</span>
              </div>
            </div>
          )}

          {/* STEP 2: CATEGORY & DETAILED FEEDBACK */}
          {step === "details" && (
            <form onSubmit={handleSubmit} className="space-y-3 pr-6">
              <div>
                <h4 className="text-xs font-semibold text-slate-200 leading-snug">
                  Which of the following issues have you experienced with Operon?
                </h4>
              </div>

              {/* Select Category */}
              <div>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-[#121316] border border-[#2b2c34] text-slate-200 text-xs rounded-lg p-2.5 outline-none focus:border-[#5C8EFA] cursor-pointer"
                >
                  <option value="">Select option</option>
                  <option value="Usability & Navigation">Usability & Navigation</option>
                  <option value="My Day & Daily Planning">My Day & Daily Planning</option>
                  <option value="Tasks & Task Board">Tasks & Task Board</option>
                  <option value="Calendar & Scheduling">Calendar & Scheduling</option>
                  <option value="EOD (End of Day) Tasks">EOD (End of Day) Tasks</option>
                  <option value="Blockers & Inbox Notifications">Blockers & Inbox Notifications</option>
                  <option value="Time Tracking & Timer">Time Tracking & Timer</option>
                  {isManager && (
                    <option value="Team Capacity & Executive Dashboard">Team Capacity & Executive Dashboard</option>
                  )}
                  <option value="Performance & Speed">Performance & Speed</option>
                  <option value="Bug / Technical Issue">Bug / Technical Issue</option>
                  <option value="Feature Suggestion">Feature Suggestion</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Detailed Experience Textarea */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-300">
                  Please tell us more about the issues you've experienced.
                </label>
                <textarea
                  value={detailedFeedback}
                  onChange={(e) => setDetailedFeedback(e.target.value)}
                  rows={3}
                  placeholder="Describe your experience..."
                  className="w-full bg-[#121316] border border-[#2b2c34] text-slate-200 text-xs rounded-lg p-2.5 outline-none focus:border-[#5C8EFA] resize-none placeholder:text-slate-500"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-white hover:bg-slate-200 text-slate-900 font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-slate-900" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <span>Submit</span>
                )}
              </button>
            </form>
          )}

          {/* STEP 3: THANK YOU */}
          {step === "thankyou" && (
            <div className="py-4 text-center space-y-2">
              <div className="flex justify-center">
                <div className="h-10 w-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
              </div>
              <h4 className="text-sm font-bold text-slate-100 flex items-center justify-center gap-1.5">
                Thanks so much for your feedback! 🙏
              </h4>
              <p className="text-[11px] text-slate-400">
                Your response helps us continuously improve Operon.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
