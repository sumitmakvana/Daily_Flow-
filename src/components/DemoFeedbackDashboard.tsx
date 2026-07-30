import React, { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { fetchDemoFeedbackStats } from "@/services/demo-feedback.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star, RefreshCw, ThumbsUp, MessageSquare, Download, CheckCircle2, Award } from "lucide-react";
import { toast } from "sonner";

export function DemoFeedbackDashboard() {
  const [stats, setStats] = useState<any>({
    totalResponses: 0,
    usefulPercentage: 100,
    averageRating: 4.8,
    responses: []
  });
  const [loading, setLoading] = useState<boolean>(false);

  const fetchDemoFeedbackStatsFn = useServerFn(fetchDemoFeedbackStats);

  const loadFeedbackData = async () => {
    setLoading(true);
    try {
      const data = await fetchDemoFeedbackStatsFn();
      
      // Merge DB rows with any local storage responses
      const localLogs = JSON.parse(localStorage.getItem("daily_flow_demo_feedback_logs") || "[]");
      const dbResponses = data.responses || [];
      
      const combinedResponses = [...dbResponses];
      localLogs.forEach((local: any) => {
        if (!combinedResponses.some((r: any) => r.session_id === local.session_id)) {
          combinedResponses.push({
            id: local.session_id,
            user_email: local.user_email || "Demo User",
            user_role: local.user_role || "member",
            is_useful: local.is_useful,
            overall_rating: local.overall_rating,
            ratings_json: local.ratings_json,
            most_liked_feature: local.most_liked_feature,
            improvement_suggestions: local.improvement_suggestions,
            detailed_feedback: local.detailed_feedback,
            completed_at: local.timestamp || new Date().toISOString()
          });
        }
      });

      const totalCount = combinedResponses.length;
      if (totalCount > 0) {
        const usefulCount = combinedResponses.filter((r: any) => r.is_useful === "yes" || r.is_useful === "partially").length;
        const usefulPct = Math.round((usefulCount / totalCount) * 100);
        const sumRating = combinedResponses.reduce((acc: number, r: any) => acc + (Number(r.overall_rating) || 5), 0);
        const avgRating = Number((sumRating / totalCount).toFixed(1));

        setStats({
          totalResponses: totalCount,
          usefulPercentage: usefulPct,
          averageRating: avgRating,
          responses: combinedResponses
        });
      } else {
        setStats(data);
      }
    } catch (err) {
      console.warn("Failed to load feedback stats:", err);
      toast.error("Could not fetch feedback stats from DB");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedbackData();
  }, []);

  const exportToCSV = () => {
    if (stats.responses.length === 0) {
      toast.error("No feedback entries to export");
      return;
    }

    const headers = ["User Email", "Role", "Is Useful", "Rating", "Most Liked Feature", "Feedback", "Submitted At"];
    const rows = stats.responses.map((r: any) => [
      `"${r.user_email || "Anonymous"}"`,
      `"${r.user_role || "member"}"`,
      `"${r.is_useful || "yes"}"`,
      r.overall_rating || 5,
      `"${r.most_liked_feature || ""}"`,
      `"${(r.detailed_feedback || r.improvement_suggestions || "").replace(/"/g, '""')}"`,
      `"${r.completed_at || ""}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e: string[]) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `demo_app_feedback_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Demo Feedback CSV exported!");
  };

  const handleClearLocalCache = () => {
    localStorage.removeItem("daily_flow_demo_feedback_logs");
    setStats({
      totalResponses: 0,
      usefulPercentage: 100,
      averageRating: 4.8,
      responses: []
    });
    toast.success("Cleared local browser feedback cache!");
  };

  return (
    <Card className="p-5 border-border/50 bg-card/60 backdrop-blur-sm shadow-md space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-500" />
            Interactive App Guide Utility Feedback & Response Logs
          </h2>
          <p className="text-xs text-muted-foreground">
            Live insights saved in database table <span className="font-mono text-primary">demo_feedback_logs</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearLocalCache}
            className="text-xs font-semibold gap-1.5 cursor-pointer text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
          >
            Clear Local Cache
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            disabled={stats.responses.length === 0}
            className="text-xs font-semibold gap-1.5 cursor-pointer"
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadFeedbackData}
            disabled={loading}
            className="text-xs font-semibold gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* METRICS SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-between">
          <div>
            <span className="text-xs text-muted-foreground font-medium block">Total Demo Submissions</span>
            <span className="text-2xl font-bold text-violet-400 font-mono">{stats.totalResponses}</span>
          </div>
          <MessageSquare className="h-7 w-7 text-violet-400 opacity-80" />
        </div>

        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
          <div>
            <span className="text-xs text-muted-foreground font-medium block">App Usefulness Verdict</span>
            <span className="text-2xl font-bold text-emerald-400 font-mono">{stats.usefulPercentage}% Useful</span>
          </div>
          <ThumbsUp className="h-7 w-7 text-emerald-400 opacity-80" />
        </div>

        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
          <div>
            <span className="text-xs text-muted-foreground font-medium block">Average App Rating</span>
            <span className="text-2xl font-bold text-amber-400 font-mono">{stats.averageRating} / 5.0 ⭐</span>
          </div>
          <Star className="h-7 w-7 text-amber-400 fill-amber-400 opacity-80" />
        </div>
      </div>

      {/* DETAILED USER FEEDBACK LOGS TABLE */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Individual User Responses ({stats.responses.length})
        </h3>

        {stats.responses.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground bg-muted/20 rounded-xl border border-border/40">
            No demo feedback responses recorded yet. Try clicking the "Start Figma Live Demo & Feedback" banner!
          </div>
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {stats.responses.map((res: any, idx: number) => (
              <div key={res.id || idx} className="p-3.5 rounded-xl border border-border/50 bg-background/50 space-y-2 hover:bg-background/80 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">{res.user_email || "Demo User"}</span>
                    <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                      {res.user_role || "member"}
                    </Badge>
                    <Badge className={
                      res.is_useful === "yes" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]" : "bg-amber-500/10 text-amber-600 text-[10px]"
                    }>
                      {res.is_useful === "yes" ? "🟢 Useful" : "🟡 Partial"}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`h-3.5 w-3.5 ${
                          (res.overall_rating || 5) >= star ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                        }`}
                      />
                    ))}
                    <span className="text-xs font-bold font-mono ml-1">{res.overall_rating || 5}/5</span>
                  </div>
                </div>

                {res.most_liked_feature && (
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">Favorite Feature:</strong> {res.most_liked_feature}
                  </p>
                )}

                {(res.detailed_feedback || res.improvement_suggestions) && (
                  <p className="text-xs text-muted-foreground bg-muted/40 p-2 rounded-lg border border-border/30 italic">
                    "{res.detailed_feedback || res.improvement_suggestions}"
                  </p>
                )}

                <div className="text-[10px] text-muted-foreground/60 text-right">
                  Submitted: {res.completed_at ? new Date(res.completed_at).toLocaleString() : "Just now"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
