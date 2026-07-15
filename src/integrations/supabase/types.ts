export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      adoption_daily: {
        Row: {
          blocker_usage: boolean
          eod_submitted: boolean
          notif_interactions: number
          planning_views: number
          rollup_date: string
          status_updates_count: number
          user_id: string
        }
        Insert: {
          blocker_usage?: boolean
          eod_submitted?: boolean
          notif_interactions?: number
          planning_views?: number
          rollup_date: string
          status_updates_count?: number
          user_id: string
        }
        Update: {
          blocker_usage?: boolean
          eod_submitted?: boolean
          notif_interactions?: number
          planning_views?: number
          rollup_date?: string
          status_updates_count?: number
          user_id?: string
        }
        Relationships: []
      }
      approval_chains: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          type_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          type_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          type_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "approval_chains_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_decisions: {
        Row: {
          approver_id: string
          comment: string | null
          decided_at: string
          decision: string
          id: string
          request_id: string
          step_order: number
        }
        Insert: {
          approver_id: string
          comment?: string | null
          decided_at?: string
          decision: string
          id?: string
          request_id: string
          step_order: number
        }
        Update: {
          approver_id?: string
          comment?: string | null
          decided_at?: string
          decision?: string
          id?: string
          request_id?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "approval_decisions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_outbox_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_kind: string
          id: string
          payload: Json
          processed_at: string | null
          request_id: string
          work_item_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_kind: string
          id?: string
          payload?: Json
          processed_at?: string | null
          request_id: string
          work_item_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_kind?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          request_id?: string
          work_item_id?: string | null
        }
        Relationships: []
      }
      approval_requests: {
        Row: {
          chain_id: string
          completed_at: string | null
          created_at: string
          current_step: number
          id: string
          requested_at: string
          requested_by: string | null
          status: string
          updated_at: string
          work_item_id: string
        }
        Insert: {
          chain_id: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
          work_item_id: string
        }
        Update: {
          chain_id?: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_chain_id_fkey"
            columns: ["chain_id"]
            isOneToOne: false
            referencedRelation: "approval_chains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_steps: {
        Row: {
          allow_self: boolean
          approver_mode: string
          approver_role: Database["public"]["Enums"]["app_role"] | null
          approver_role_key: string | null
          approver_user_id: string | null
          chain_id: string
          created_at: string
          id: string
          name: string
          required_count: number
          step_order: number
        }
        Insert: {
          allow_self?: boolean
          approver_mode: string
          approver_role?: Database["public"]["Enums"]["app_role"] | null
          approver_role_key?: string | null
          approver_user_id?: string | null
          chain_id: string
          created_at?: string
          id?: string
          name: string
          required_count?: number
          step_order: number
        }
        Update: {
          allow_self?: boolean
          approver_mode?: string
          approver_role?: Database["public"]["Enums"]["app_role"] | null
          approver_role_key?: string | null
          approver_user_id?: string | null
          chain_id?: string
          created_at?: string
          id?: string
          name?: string
          required_count?: number
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "approval_steps_chain_id_fkey"
            columns: ["chain_id"]
            isOneToOne: false
            referencedRelation: "approval_chains"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          file_name: string
          file_size: number
          file_type: string
          id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
          work_item_id: string
        }
        Insert: {
          file_name: string
          file_size: number
          file_type: string
          id?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
          work_item_id: string
        }
        Update: {
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_exports: {
        Row: {
          created_at: string
          id: string
          kind: string
          params: Json
          row_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          params?: Json
          row_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          params?: Json
          row_count?: number
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      automation_action_log: {
        Row: {
          action_index: number
          action_kind: string
          created_at: string
          error: string | null
          id: string
          result: Json | null
          run_id: string
          status: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action_index: number
          action_kind: string
          created_at?: string
          error?: string | null
          id?: string
          result?: Json | null
          run_id: string
          status: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action_index?: number
          action_kind?: string
          created_at?: string
          error?: string | null
          id?: string
          result?: Json | null
          run_id?: string
          status?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_action_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_events: {
        Row: {
          actor_id: string | null
          attempts: number
          available_at: string
          depth: number
          drop_reason: string | null
          dropped: boolean
          enqueued_at: string
          entity_id: string | null
          entity_type: string
          event_kind: string
          id: string
          payload: Json
          processed_at: string | null
        }
        Insert: {
          actor_id?: string | null
          attempts?: number
          available_at?: string
          depth?: number
          drop_reason?: string | null
          dropped?: boolean
          enqueued_at?: string
          entity_id?: string | null
          entity_type: string
          event_kind: string
          id?: string
          payload?: Json
          processed_at?: string | null
        }
        Update: {
          actor_id?: string | null
          attempts?: number
          available_at?: string
          depth?: number
          drop_reason?: string | null
          dropped?: boolean
          enqueued_at?: string
          entity_id?: string | null
          entity_type?: string
          event_kind?: string
          id?: string
          payload?: Json
          processed_at?: string | null
        }
        Relationships: []
      }
      automation_queue_stats: {
        Row: {
          id: number
          pending_count: number
          updated_at: string
        }
        Insert: {
          id?: number
          pending_count?: number
          updated_at?: string
        }
        Update: {
          id?: number
          pending_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          actions: Json
          allow_self_retrigger: boolean
          auto_disabled_at: string | null
          auto_disabled_reason: string | null
          condition_expr: Json
          created_at: string
          created_by: string | null
          dedupe_window_minutes: number
          description: string | null
          description_internal: string | null
          id: string
          is_active: boolean
          max_runs_per_entity: number | null
          max_runs_per_minute: number
          name: string
          run_mode: string
          sort_order: number
          trigger_kind: string
          type_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actions?: Json
          allow_self_retrigger?: boolean
          auto_disabled_at?: string | null
          auto_disabled_reason?: string | null
          condition_expr?: Json
          created_at?: string
          created_by?: string | null
          dedupe_window_minutes?: number
          description?: string | null
          description_internal?: string | null
          id?: string
          is_active?: boolean
          max_runs_per_entity?: number | null
          max_runs_per_minute?: number
          name: string
          run_mode?: string
          sort_order?: number
          trigger_kind: string
          type_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actions?: Json
          allow_self_retrigger?: boolean
          auto_disabled_at?: string | null
          auto_disabled_reason?: string | null
          condition_expr?: Json
          created_at?: string
          created_by?: string | null
          dedupe_window_minutes?: number
          description?: string | null
          description_internal?: string | null
          id?: string
          is_active?: boolean
          max_runs_per_entity?: number | null
          max_runs_per_minute?: number
          name?: string
          run_mode?: string
          sort_order?: number
          trigger_kind?: string
          type_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          actions_log: Json
          attempts: number
          dedupe_key: string | null
          entity_id: string | null
          entity_type: string | null
          error: string | null
          event_id: string | null
          finished_at: string | null
          id: string
          rule_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          actions_log?: Json
          attempts?: number
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          event_id?: string | null
          finished_at?: string | null
          id?: string
          rule_id?: string | null
          started_at?: string
          status: string
        }
        Update: {
          actions_log?: Json
          attempts?: number
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          event_id?: string | null
          finished_at?: string | null
          id?: string
          rule_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "automation_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      carry_forward_events: {
        Row: {
          created_at: string
          created_by: string | null
          from_date: string
          id: string
          reason: string
          task_id: string
          to_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_date: string
          id?: string
          reason?: string
          task_id: string
          to_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_date?: string
          id?: string
          reason?: string
          task_id?: string
          to_date?: string
        }
        Relationships: []
      }
      comment_mentions: {
        Row: {
          comment_id: string
          created_at: string
          mentioned_user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          mentioned_user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          mentioned_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_mentions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_comment_id: string | null
          user_id: string
          work_item_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_comment_id?: string | null
          user_id: string
          work_item_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_comment_id?: string | null
          user_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      config_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          label: string
          payload: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          label: string
          payload: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          label?: string
          payload?: Json
        }
        Relationships: []
      }
      cron_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      cron_invocations: {
        Row: {
          created_at: string
          nonce: string
          route: string
          ts: string
        }
        Insert: {
          created_at?: string
          nonce: string
          route: string
          ts: string
        }
        Update: {
          created_at?: string
          nonce?: string
          route?: string
          ts?: string
        }
        Relationships: []
      }
      daily_workload_snapshot: {
        Row: {
          active_count: number
          actual_hours: number
          blocked_count: number
          completed_count: number
          created_at: string
          delayed_count: number
          id: string
          planned_hours: number
          snapshot_date: string
          user_id: string
        }
        Insert: {
          active_count?: number
          actual_hours?: number
          blocked_count?: number
          completed_count?: number
          created_at?: string
          delayed_count?: number
          id?: string
          planned_hours?: number
          snapshot_date: string
          user_id: string
        }
        Update: {
          active_count?: number
          actual_hours?: number
          blocked_count?: number
          completed_count?: number
          created_at?: string
          delayed_count?: number
          id?: string
          planned_hours?: number
          snapshot_date?: string
          user_id?: string
        }
        Relationships: []
      }
      eod_checkins: {
        Row: {
          blocker_count: number
          checkin_date: string
          completed_count: number
          id: string
          note: string | null
          pending_count: number
          remaining_hours: number
          submitted_at: string
          tomorrow_priority_task_id: string | null
          user_id: string
        }
        Insert: {
          blocker_count?: number
          checkin_date?: string
          completed_count?: number
          id?: string
          note?: string | null
          pending_count?: number
          remaining_hours?: number
          submitted_at?: string
          tomorrow_priority_task_id?: string | null
          user_id: string
        }
        Update: {
          blocker_count?: number
          checkin_date?: string
          completed_count?: number
          id?: string
          note?: string | null
          pending_count?: number
          remaining_hours?: number
          submitted_at?: string
          tomorrow_priority_task_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      holiday_calendar: {
        Row: {
          calendar_date: string
          id: string
          label: string
        }
        Insert: {
          calendar_date: string
          id?: string
          label: string
        }
        Update: {
          calendar_date?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      industry_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          industry: string
          installed_at: string | null
          installed_by: string | null
          is_installed: boolean
          key: string
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          industry: string
          installed_at?: string | null
          installed_by?: string | null
          is_installed?: boolean
          key: string
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          industry?: string
          installed_at?: string | null
          installed_by?: string | null
          is_installed?: boolean
          key?: string
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          digest_enabled: boolean
          eod_reminder_hour: number
          notify_assignment: boolean
          notify_blocker_resolved: boolean
          notify_manager_delays: boolean
          notify_manager_overload: boolean
          notify_priority_change: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          digest_enabled?: boolean
          eod_reminder_hour?: number
          notify_assignment?: boolean
          notify_blocker_resolved?: boolean
          notify_manager_delays?: boolean
          notify_manager_overload?: boolean
          notify_priority_change?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          digest_enabled?: boolean
          eod_reminder_hour?: number
          notify_assignment?: boolean
          notify_blocker_resolved?: boolean
          notify_manager_delays?: boolean
          notify_manager_overload?: boolean
          notify_priority_change?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          read_at: string | null
          task_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          read_at?: string | null
          task_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          read_at?: string | null
          task_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      nudges: {
        Row: {
          body: string | null
          cooldown_until: string
          created_at: string
          dismissed_at: string | null
          id: string
          kind: string
          read_at: string | null
          severity: string
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          cooldown_until?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          kind: string
          read_at?: string | null
          severity?: string
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          cooldown_until?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          severity?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      operations_failures: {
        Row: {
          context: Json
          created_at: string
          entity_id: string | null
          entity_type: string | null
          error_code: string | null
          error_message: string
          id: string
          source: string
        }
        Insert: {
          context?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          error_message: string
          id?: string
          source: string
        }
        Update: {
          context?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          error_message?: string
          id?: string
          source?: string
        }
        Relationships: []
      }
      org_role_hierarchy: {
        Row: {
          child_role_id: string
          parent_role_id: string
        }
        Insert: {
          child_role_id: string
          parent_role_id: string
        }
        Update: {
          child_role_id?: string
          parent_role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_role_hierarchy_child_role_id_fkey"
            columns: ["child_role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_role_hierarchy_parent_role_id_fkey"
            columns: ["parent_role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      planning_suggestions: {
        Row: {
          created_at: string
          from_user_id: string | null
          id: string
          kind: string
          payload: Json
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          target_date: string
          task_id: string | null
          to_user_id: string | null
        }
        Insert: {
          created_at?: string
          from_user_id?: string | null
          id?: string
          kind: string
          payload?: Json
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          target_date?: string
          task_id?: string | null
          to_user_id?: string | null
        }
        Update: {
          created_at?: string
          from_user_id?: string | null
          id?: string
          kind?: string
          payload?: Json
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          target_date?: string
          task_id?: string | null
          to_user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          is_active: boolean
          manager_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          email: string
          id: string
          is_active?: boolean
          manager_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profile_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client: string | null
          created_at: string
          id: string
          name: string
          sla_days: number
          status: string
          team_id: string | null
        }
        Insert: {
          client?: string | null
          created_at?: string
          id?: string
          name: string
          sla_days?: number
          status?: string
          team_id?: string | null
        }
        Update: {
          client?: string | null
          created_at?: string
          id?: string
          name?: string
          sla_days?: number
          status?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_events: {
        Row: {
          detected_at: string
          detection_date: string
          entity_id: string
          entity_type: string
          id: string
          kind: string
          payload: Json
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          summary: string
        }
        Insert: {
          detected_at?: string
          detection_date?: string
          entity_id: string
          entity_type: string
          id?: string
          kind: string
          payload?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          summary: string
        }
        Update: {
          detected_at?: string
          detection_date?: string
          entity_id?: string
          entity_type?: string
          id?: string
          kind?: string
          payload?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          summary?: string
        }
        Relationships: []
      }
      risk_rules_config: {
        Row: {
          enabled: boolean
          kind: string
          threshold_count: number | null
          threshold_days: number | null
          threshold_pct: number | null
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          kind: string
          threshold_count?: number | null
          threshold_days?: number | null
          threshold_pct?: number | null
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          kind?: string
          threshold_count?: number | null
          threshold_days?: number | null
          threshold_pct?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      task_eod_submissions: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          actual_hours: number
          id: string
          note: string | null
          progress_status: string
          submission_date: string
          submitted_at: string
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_hours?: number
          id?: string
          note?: string | null
          progress_status: string
          submission_date?: string
          submitted_at?: string
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_hours?: number
          id?: string
          note?: string | null
          progress_status?: string
          submission_date?: string
          submitted_at?: string
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_eod_submissions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_history: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          new_status: Database["public"]["Enums"]["task_status"] | null
          old_status: Database["public"]["Enums"]["task_status"] | null
          task_id: string
          updated_by: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          new_status?: Database["public"]["Enums"]["task_status"] | null
          old_status?: Database["public"]["Enums"]["task_status"] | null
          task_id: string
          updated_by?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          new_status?: Database["public"]["Enums"]["task_status"] | null
          old_status?: Database["public"]["Enums"]["task_status"] | null
          task_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_history_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profile_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_history_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          actual_hours: number | null
          assigned_to: string | null
          blocked_at: string | null
          blocker_reason: string | null
          carry_forward_count: number
          client: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          done: boolean
          due_date: string | null
          id: string
          last_carry_forward_at: string | null
          original_due_date: string | null
          planned_hours: number | null
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          project_name: string | null
          remarks: string | null
          reviewer: string | null
          sla_due_at: string | null
          sprint_week: string | null
          status: Database["public"]["Enums"]["task_status"]
          status_id: string | null
          task_code: string
          task_name: string
          team_id: string | null
          type_id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          actual_hours?: number | null
          assigned_to?: string | null
          blocked_at?: string | null
          blocker_reason?: string | null
          carry_forward_count?: number
          client?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          done?: boolean
          due_date?: string | null
          id?: string
          last_carry_forward_at?: string | null
          original_due_date?: string | null
          planned_hours?: number | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          project_name?: string | null
          remarks?: string | null
          reviewer?: string | null
          sla_due_at?: string | null
          sprint_week?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          status_id?: string | null
          task_code: string
          task_name: string
          team_id?: string | null
          type_id: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          actual_hours?: number | null
          assigned_to?: string | null
          blocked_at?: string | null
          blocker_reason?: string | null
          carry_forward_count?: number
          client?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          done?: boolean
          due_date?: string | null
          id?: string
          last_carry_forward_at?: string | null
          original_due_date?: string | null
          planned_hours?: number | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          project_name?: string | null
          remarks?: string | null
          reviewer?: string | null
          sla_due_at?: string | null
          sprint_week?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          status_id?: string | null
          task_code?: string
          task_name?: string
          team_id?: string | null
          type_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profile_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_fkey"
            columns: ["reviewer"]
            isOneToOne: false
            referencedRelation: "profile_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_fkey"
            columns: ["reviewer"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profile_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          manager_id: string | null
          name: string
          parent_team_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          manager_id?: string | null
          name: string
          parent_team_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          manager_id?: string | null
          name?: string
          parent_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_parent_team_id_fkey"
            columns: ["parent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      template_components: {
        Row: {
          apply_order: number
          component_kind: string
          created_at: string
          id: string
          payload: Json
          template_id: string
        }
        Insert: {
          apply_order?: number
          component_kind: string
          created_at?: string
          id?: string
          payload: Json
          template_id: string
        }
        Update: {
          apply_order?: number
          component_kind?: string
          created_at?: string
          id?: string
          payload?: Json
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_components_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "industry_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_onboarding: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: number
          data: Json
          id: number
          industry: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          data?: Json
          id?: number
          industry?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          data?: Json
          id?: number
          industry?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_org_roles: {
        Row: {
          created_at: string
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_org_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_streaks: {
        Row: {
          current_streak: number
          last_update_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          last_update_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          last_update_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      work_item_field_defs: {
        Row: {
          created_at: string
          data_type: string
          id: string
          is_active: boolean
          key: string
          label: string
          options: Json
          required: boolean
          required_for_completion: boolean
          sort_order: number
          type_id: string
          updated_at: string
          validation: Json
        }
        Insert: {
          created_at?: string
          data_type: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          options?: Json
          required?: boolean
          required_for_completion?: boolean
          sort_order?: number
          type_id: string
          updated_at?: string
          validation?: Json
        }
        Update: {
          created_at?: string
          data_type?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          options?: Json
          required?: boolean
          required_for_completion?: boolean
          sort_order?: number
          type_id?: string
          updated_at?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "work_item_field_defs_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_relations: {
        Row: {
          created_at: string
          created_by: string | null
          from_work_item_id: string
          id: string
          relation_kind: string
          to_work_item_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_work_item_id: string
          id?: string
          relation_kind: string
          to_work_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_work_item_id?: string
          id?: string
          relation_kind?: string
          to_work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_relations_from_work_item_id_fkey"
            columns: ["from_work_item_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_relations_to_work_item_id_fkey"
            columns: ["to_work_item_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_statuses: {
        Row: {
          category: string
          color: string | null
          created_at: string
          id: string
          is_initial: boolean
          is_terminal: boolean
          key: string
          label: string
          sort_order: number
          type_id: string
          updated_at: string
        }
        Insert: {
          category: string
          color?: string | null
          created_at?: string
          id?: string
          is_initial?: boolean
          is_terminal?: boolean
          key: string
          label: string
          sort_order?: number
          type_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          color?: string | null
          created_at?: string
          id?: string
          is_initial?: boolean
          is_terminal?: boolean
          key?: string
          label?: string
          sort_order?: number
          type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_statuses_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_transitions: {
        Row: {
          created_at: string
          from_status_id: string | null
          guard_expr: Json
          id: string
          label: string | null
          required_role: Database["public"]["Enums"]["app_role"] | null
          required_role_key: string | null
          sort_order: number
          to_status_id: string
          type_id: string
        }
        Insert: {
          created_at?: string
          from_status_id?: string | null
          guard_expr?: Json
          id?: string
          label?: string | null
          required_role?: Database["public"]["Enums"]["app_role"] | null
          required_role_key?: string | null
          sort_order?: number
          to_status_id: string
          type_id: string
        }
        Update: {
          created_at?: string
          from_status_id?: string | null
          guard_expr?: Json
          id?: string
          label?: string | null
          required_role?: Database["public"]["Enums"]["app_role"] | null
          required_role_key?: string | null
          sort_order?: number
          to_status_id?: string
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_transitions_from_status_id_fkey"
            columns: ["from_status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_transitions_to_status_id_fkey"
            columns: ["to_status_id"]
            isOneToOne: false
            referencedRelation: "work_item_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_transitions_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_types: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          id_prefix: string | null
          id_seq: number
          key: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          id_prefix?: string | null
          id_seq?: number
          key: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          id_prefix?: string | null
          id_seq?: number
          key?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      work_settings: {
        Row: {
          daily_capacity_hours: number
          id: number
          sla_default_days: number
          updated_at: string
          workdays: number[]
          morning_digest_time: string
          evening_digest_time: string
        }
        Insert: {
          daily_capacity_hours?: number
          id?: number
          sla_default_days?: number
          updated_at?: string
          workdays?: number[]
          morning_digest_time?: string
          evening_digest_time?: string
        }
        Update: {
          daily_capacity_hours?: number
          id?: number
          sla_default_days?: number
          updated_at?: string
          workdays?: number[]
          morning_digest_time?: string
          evening_digest_time?: string
        }
        Relationships: []
      }
    }
    Views: {
      profile_emails: {
        Row: {
          email: string | null
          id: string | null
        }
        Insert: {
          email?: string | null
          id?: string | null
        }
        Update: {
          email?: string | null
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cron_secret: { Args: never; Returns: string }
      _current_automation_depth: { Args: never; Returns: number }
      adoption_rollup: { Args: { _for_date?: string }; Returns: number }
      automation_replay_dead_run: {
        Args: { _run_id: string }
        Returns: undefined
      }
      automation_set_depth: { Args: { _depth: number }; Returns: undefined }
      automation_try_lock: { Args: { _key: number }; Returns: boolean }
      automation_unlock: { Args: { _key: number }; Returns: boolean }
      bump_user_streak: { Args: { _user_id: string }; Returns: undefined }
      capture_config_payload: { Args: never; Returns: Json }
      carry_task_forward: {
        Args: {
          _expected_version?: number
          _reason?: string
          _task_id: string
          _to_date: string
        }
        Returns: {
          actual_hours: number | null
          assigned_to: string | null
          blocked_at: string | null
          blocker_reason: string | null
          carry_forward_count: number
          client: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          done: boolean
          due_date: string | null
          id: string
          last_carry_forward_at: string | null
          original_due_date: string | null
          planned_hours: number | null
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          project_name: string | null
          remarks: string | null
          reviewer: string | null
          sla_due_at: string | null
          sprint_week: string | null
          status: Database["public"]["Enums"]["task_status"]
          status_id: string | null
          task_code: string
          task_name: string
          team_id: string | null
          type_id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      detect_risks: { Args: never; Returns: number }
      enqueue_automation_event: {
        Args: {
          _actor_id?: string
          _available_at?: string
          _depth?: number
          _entity_id: string
          _entity_type: string
          _event_kind: string
          _payload?: Json
        }
        Returns: string
      }
      exec_summary: {
        Args: {
          _days?: number
          _manager?: string
          _project?: string
          _team?: string
          _type?: string
        }
        Returns: Json
      }
      generate_nudges: { Args: never; Returns: number }
      generate_planning_suggestions: {
        Args: { _for_date?: string }
        Returns: number
      }
      has_org_role: {
        Args: { _role_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      install_template: { Args: { _template_id: string }; Returns: string }
      is_manager_or_admin: { Args: { _user_id: string }; Returns: boolean }
      is_request_approver: {
        Args: { _request_id: string; _user_id: string }
        Returns: boolean
      }
      manager_visible_team_ids: { Args: { _user: string }; Returns: string[] }
      next_working_day: { Args: { _from?: string }; Returns: string }
      notify_task_blocked: {
        Args: { _reason: string; _task_id: string }
        Returns: undefined
      }
      predict_tomorrow_risks: {
        Args: never
        Returns: {
          reasons: string[]
          risk_score: number
          task_id: string
        }[]
      }
      purge_automation_artifacts: { Args: { _days?: number }; Returns: number }
      purge_old_audit_exports: { Args: { _days?: number }; Returns: number }
      purge_old_notifications: { Args: { _days?: number }; Returns: number }
      purge_old_risk_events: { Args: { _days?: number }; Returns: number }
      purge_old_snapshots: { Args: { _keep?: number }; Returns: number }
      purge_old_task_history: { Args: { _days?: number }; Returns: number }
      record_export: {
        Args: { _filters: Json; _kind: string; _row_count: number }
        Returns: string
      }
      restore_config: { Args: { _snapshot_id: string }; Returns: undefined }
      snapshot_config: {
        Args: { _kind?: string; _label: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "member"
      task_priority: "High" | "Medium" | "Low"
      task_status:
        | "To Do"
        | "In Progress"
        | "In Review"
        | "Blocked"
        | "On Hold"
        | "Completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "member"],
      task_priority: ["High", "Medium", "Low"],
      task_status: [
        "To Do",
        "In Progress",
        "In Review",
        "Blocked",
        "On Hold",
        "Completed",
      ],
    },
  },
} as const
