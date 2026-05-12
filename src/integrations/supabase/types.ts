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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          payload: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          payload?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      global_settings: {
        Row: {
          anthropic_spend_cap_monthly_usd: number
          anthropic_spend_current_month_usd: number
          cap_alert_sent_this_month: boolean
          default_drive_folder_for_standalone_vs_decks: string | null
          email_notifications_enabled: boolean
          id: string
          in_app_notifications_enabled: boolean
          talent_scout_competitor_list: string[]
          talent_scout_packet_default_count: number
          updated_at: string
          venue_research_priority_sites: string[]
        }
        Insert: {
          anthropic_spend_cap_monthly_usd?: number
          anthropic_spend_current_month_usd?: number
          cap_alert_sent_this_month?: boolean
          default_drive_folder_for_standalone_vs_decks?: string | null
          email_notifications_enabled?: boolean
          id?: string
          in_app_notifications_enabled?: boolean
          talent_scout_competitor_list?: string[]
          talent_scout_packet_default_count?: number
          updated_at?: string
          venue_research_priority_sites?: string[]
        }
        Update: {
          anthropic_spend_cap_monthly_usd?: number
          anthropic_spend_current_month_usd?: number
          cap_alert_sent_this_month?: boolean
          default_drive_folder_for_standalone_vs_decks?: string | null
          email_notifications_enabled?: boolean
          id?: string
          in_app_notifications_enabled?: boolean
          talent_scout_competitor_list?: string[]
          talent_scout_packet_default_count?: number
          updated_at?: string
          venue_research_priority_sites?: string[]
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          delivered_email: boolean
          delivered_in_app: boolean
          id: string
          link_url: string | null
          read: boolean
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          delivered_email?: boolean
          delivered_in_app?: boolean
          id?: string
          link_url?: string | null
          read?: boolean
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          delivered_email?: boolean
          delivered_in_app?: boolean
          id?: string
          link_url?: string | null
          read?: boolean
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_account_managers: {
        Row: {
          project_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_account_managers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_account_managers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_designers: {
        Row: {
          project_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_designers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_designers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_venues: {
        Row: {
          project_id: string
          venue_id: string
        }
        Insert: {
          project_id: string
          venue_id: string
        }
        Update: {
          project_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_venues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_venues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          budget_sheet_url: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          design_decks_folder_url: string | null
          id: string
          latest_creative_deck_url: string | null
          live_dates_end: string | null
          live_dates_start: string | null
          name: string
          notes: string | null
          production_folder_url: string | null
          slack_channel_url: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          budget_sheet_url?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          design_decks_folder_url?: string | null
          id?: string
          latest_creative_deck_url?: string | null
          live_dates_end?: string | null
          live_dates_start?: string | null
          name: string
          notes?: string | null
          production_folder_url?: string | null
          slack_channel_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          budget_sheet_url?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          design_decks_folder_url?: string | null
          id?: string
          latest_creative_deck_url?: string | null
          live_dates_end?: string | null
          live_dates_start?: string | null
          name?: string
          notes?: string | null
          production_folder_url?: string | null
          slack_channel_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          project_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          project_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          project_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ts_candidate_attachments: {
        Row: {
          attachment_type: Database["public"]["Enums"]["ts_candidate_attachment_type"]
          candidate_id: string
          created_at: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
        }
        Insert: {
          attachment_type: Database["public"]["Enums"]["ts_candidate_attachment_type"]
          candidate_id: string
          created_at?: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
        }
        Update: {
          attachment_type?: Database["public"]["Enums"]["ts_candidate_attachment_type"]
          candidate_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ts_candidate_attachments_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "ts_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      ts_candidates: {
        Row: {
          applied_date: string | null
          created_at: string
          detected_links: Json
          email: string | null
          email_body_text: string | null
          gmail_message_id: string | null
          id: string
          internal_notes: string | null
          is_referral: boolean
          key_gaps: Json
          last_evaluated_at: string | null
          location: string | null
          manually_reviewed: boolean
          name: string | null
          portfolio_path_or_url: string | null
          portfolio_type: Database["public"]["Enums"]["ts_candidate_portfolio_type"]
          pull_round_id: string
          quick_overview: Json
          recruiter_overview: string | null
          referrer_email: string | null
          role_id: string
          score: number | null
          score_breakdown: Json
          status: Database["public"]["Enums"]["ts_candidate_status"]
          tier: string | null
          top_strengths: Json
          updated_at: string
        }
        Insert: {
          applied_date?: string | null
          created_at?: string
          detected_links?: Json
          email?: string | null
          email_body_text?: string | null
          gmail_message_id?: string | null
          id?: string
          internal_notes?: string | null
          is_referral?: boolean
          key_gaps?: Json
          last_evaluated_at?: string | null
          location?: string | null
          manually_reviewed?: boolean
          name?: string | null
          portfolio_path_or_url?: string | null
          portfolio_type?: Database["public"]["Enums"]["ts_candidate_portfolio_type"]
          pull_round_id: string
          quick_overview?: Json
          recruiter_overview?: string | null
          referrer_email?: string | null
          role_id: string
          score?: number | null
          score_breakdown?: Json
          status?: Database["public"]["Enums"]["ts_candidate_status"]
          tier?: string | null
          top_strengths?: Json
          updated_at?: string
        }
        Update: {
          applied_date?: string | null
          created_at?: string
          detected_links?: Json
          email?: string | null
          email_body_text?: string | null
          gmail_message_id?: string | null
          id?: string
          internal_notes?: string | null
          is_referral?: boolean
          key_gaps?: Json
          last_evaluated_at?: string | null
          location?: string | null
          manually_reviewed?: boolean
          name?: string | null
          portfolio_path_or_url?: string | null
          portfolio_type?: Database["public"]["Enums"]["ts_candidate_portfolio_type"]
          pull_round_id?: string
          quick_overview?: Json
          recruiter_overview?: string | null
          referrer_email?: string | null
          role_id?: string
          score?: number | null
          score_breakdown?: Json
          status?: Database["public"]["Enums"]["ts_candidate_status"]
          tier?: string | null
          top_strengths?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ts_candidates_pull_round_id_fkey"
            columns: ["pull_round_id"]
            isOneToOne: false
            referencedRelation: "ts_pull_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ts_candidates_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "ts_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      ts_evaluations: {
        Row: {
          candidate_id: string
          eval_prompt_snapshot: string
          evaluated_at: string
          id: string
          internal_notes_at_time: string | null
          key_gaps: Json | null
          recruiter_overview: string | null
          role_id: string
          score: number | null
          score_breakdown: Json | null
          scorecard_snapshot: Json
          tier: string | null
          top_strengths: Json | null
          triggered_by: string | null
        }
        Insert: {
          candidate_id: string
          eval_prompt_snapshot: string
          evaluated_at?: string
          id?: string
          internal_notes_at_time?: string | null
          key_gaps?: Json | null
          recruiter_overview?: string | null
          role_id: string
          score?: number | null
          score_breakdown?: Json | null
          scorecard_snapshot: Json
          tier?: string | null
          top_strengths?: Json | null
          triggered_by?: string | null
        }
        Update: {
          candidate_id?: string
          eval_prompt_snapshot?: string
          evaluated_at?: string
          id?: string
          internal_notes_at_time?: string | null
          key_gaps?: Json | null
          recruiter_overview?: string | null
          role_id?: string
          score?: number | null
          score_breakdown?: Json | null
          scorecard_snapshot?: Json
          tier?: string | null
          top_strengths?: Json | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ts_evaluations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "ts_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ts_evaluations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "ts_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ts_evaluations_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ts_final_reviews: {
        Row: {
          candidate_count: number | null
          candidate_count_limit: number | null
          claude_raw_response: Json | null
          duration_seconds: number | null
          error_log: Json
          error_message: string | null
          final_rankings: Json
          generated_at: string
          id: string
          packet_generated_at: string | null
          packet_include_fast_track: boolean | null
          packet_top_n: number | null
          packet_url: string | null
          pool_summary: string | null
          role_id: string
          status: Database["public"]["Enums"]["ts_final_review_status"]
          step_progress: Json
          triggered_by: string | null
        }
        Insert: {
          candidate_count?: number | null
          candidate_count_limit?: number | null
          claude_raw_response?: Json | null
          duration_seconds?: number | null
          error_log?: Json
          error_message?: string | null
          final_rankings?: Json
          generated_at?: string
          id?: string
          packet_generated_at?: string | null
          packet_include_fast_track?: boolean | null
          packet_top_n?: number | null
          packet_url?: string | null
          pool_summary?: string | null
          role_id: string
          status?: Database["public"]["Enums"]["ts_final_review_status"]
          step_progress?: Json
          triggered_by?: string | null
        }
        Update: {
          candidate_count?: number | null
          candidate_count_limit?: number | null
          claude_raw_response?: Json | null
          duration_seconds?: number | null
          error_log?: Json
          error_message?: string | null
          final_rankings?: Json
          generated_at?: string
          id?: string
          packet_generated_at?: string | null
          packet_include_fast_track?: boolean | null
          packet_top_n?: number | null
          packet_url?: string | null
          pool_summary?: string | null
          role_id?: string
          status?: Database["public"]["Enums"]["ts_final_review_status"]
          step_progress?: Json
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ts_final_reviews_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "ts_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ts_final_reviews_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ts_pull_rounds: {
        Row: {
          attempt: number
          candidates_found: number
          completed_at: string | null
          created_by: string | null
          id: string
          packet_generated_at: string | null
          packet_include_fast_track: boolean | null
          packet_top_n: number | null
          packet_url: string | null
          pending_candidates: Json
          processed_count: number
          pulled_from: string | null
          pulled_to: string | null
          role_id: string
          round_number: number | null
          started_at: string
          status: Database["public"]["Enums"]["ts_pull_round_status"]
          triggered_by: Database["public"]["Enums"]["ts_pull_round_triggered_by"]
          updated_at: string
        }
        Insert: {
          attempt?: number
          candidates_found?: number
          completed_at?: string | null
          created_by?: string | null
          id?: string
          packet_generated_at?: string | null
          packet_include_fast_track?: boolean | null
          packet_top_n?: number | null
          packet_url?: string | null
          pending_candidates?: Json
          processed_count?: number
          pulled_from?: string | null
          pulled_to?: string | null
          role_id: string
          round_number?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["ts_pull_round_status"]
          triggered_by: Database["public"]["Enums"]["ts_pull_round_triggered_by"]
          updated_at?: string
        }
        Update: {
          attempt?: number
          candidates_found?: number
          completed_at?: string | null
          created_by?: string | null
          id?: string
          packet_generated_at?: string | null
          packet_include_fast_track?: boolean | null
          packet_top_n?: number | null
          packet_url?: string | null
          pending_candidates?: Json
          processed_count?: number
          pulled_from?: string | null
          pulled_to?: string | null
          role_id?: string
          round_number?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["ts_pull_round_status"]
          triggered_by?: Database["public"]["Enums"]["ts_pull_round_triggered_by"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ts_pull_rounds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ts_pull_rounds_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "ts_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      ts_roles: {
        Row: {
          auto_pull_schedule: Database["public"]["Enums"]["ts_role_auto_pull_schedule"]
          auto_rejection_threshold: number | null
          closed_at: string | null
          compensation: string | null
          competitor_bonus: Json
          created_at: string
          created_by: string | null
          email_keywords: string[]
          email_search_start_date: string | null
          evaluation_prompt: string | null
          hiring_manager_id: string | null
          hiring_priorities: string | null
          id: string
          job_description: string | null
          location: string | null
          reeval_completed_at: string | null
          reeval_failed: number
          reeval_last_progress_at: string | null
          reeval_processed: number
          reeval_started_at: string | null
          reeval_status: Database["public"]["Enums"]["ts_role_reeval_status"]
          reeval_status_filter: string | null
          reeval_total: number
          scorecard: Json
          start_date: string | null
          status: Database["public"]["Enums"]["ts_role_status"]
          title: string
          type: string | null
          updated_at: string
        }
        Insert: {
          auto_pull_schedule?: Database["public"]["Enums"]["ts_role_auto_pull_schedule"]
          auto_rejection_threshold?: number | null
          closed_at?: string | null
          compensation?: string | null
          competitor_bonus?: Json
          created_at?: string
          created_by?: string | null
          email_keywords?: string[]
          email_search_start_date?: string | null
          evaluation_prompt?: string | null
          hiring_manager_id?: string | null
          hiring_priorities?: string | null
          id?: string
          job_description?: string | null
          location?: string | null
          reeval_completed_at?: string | null
          reeval_failed?: number
          reeval_last_progress_at?: string | null
          reeval_processed?: number
          reeval_started_at?: string | null
          reeval_status?: Database["public"]["Enums"]["ts_role_reeval_status"]
          reeval_status_filter?: string | null
          reeval_total?: number
          scorecard?: Json
          start_date?: string | null
          status?: Database["public"]["Enums"]["ts_role_status"]
          title: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          auto_pull_schedule?: Database["public"]["Enums"]["ts_role_auto_pull_schedule"]
          auto_rejection_threshold?: number | null
          closed_at?: string | null
          compensation?: string | null
          competitor_bonus?: Json
          created_at?: string
          created_by?: string | null
          email_keywords?: string[]
          email_search_start_date?: string | null
          evaluation_prompt?: string | null
          hiring_manager_id?: string | null
          hiring_priorities?: string | null
          id?: string
          job_description?: string | null
          location?: string | null
          reeval_completed_at?: string | null
          reeval_failed?: number
          reeval_last_progress_at?: string | null
          reeval_processed?: number
          reeval_started_at?: string | null
          reeval_status?: Database["public"]["Enums"]["ts_role_reeval_status"]
          reeval_status_filter?: string | null
          reeval_total?: number
          scorecard?: Json
          start_date?: string | null
          status?: Database["public"]["Enums"]["ts_role_status"]
          title?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ts_roles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ts_roles_hiring_manager_id_fkey"
            columns: ["hiring_manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          active: boolean
          avatar_url: string | null
          created_at: string
          department_tags: string[]
          email: string
          full_name: string | null
          id: string
          permission_role: Database["public"]["Enums"]["permission_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          department_tags?: string[]
          email: string
          full_name?: string | null
          id: string
          permission_role?: Database["public"]["Enums"]["permission_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          department_tags?: string[]
          email?: string
          full_name?: string | null
          id?: string
          permission_role?: Database["public"]["Enums"]["permission_role"]
          updated_at?: string
        }
        Relationships: []
      }
      venue_types: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          address: string | null
          capacity: number | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          features: string[]
          id: string
          name: string
          neighborhood: string | null
          notes: string | null
          photos: string[]
          square_footage: number | null
          updated_at: string
          venue_type_id: string | null
          website_url: string | null
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          features?: string[]
          id?: string
          name: string
          neighborhood?: string | null
          notes?: string | null
          photos?: string[]
          square_footage?: number | null
          updated_at?: string
          venue_type_id?: string | null
          website_url?: string | null
        }
        Update: {
          address?: string | null
          capacity?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          features?: string[]
          id?: string
          name?: string
          neighborhood?: string | null
          notes?: string | null
          photos?: string[]
          square_footage?: number | null
          updated_at?: string
          venue_type_id?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_venue_type_id_fkey"
            columns: ["venue_type_id"]
            isOneToOne: false
            referencedRelation: "venue_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vs_candidate_venues: {
        Row: {
          address: string | null
          capacity: number | null
          considerations: string[]
          created_at: string
          derived_attrs: Json
          id: string
          include_in_deck: boolean
          key_features: string[]
          linked_venue_id: string | null
          name: string
          neighborhood: string | null
          notes: string | null
          pitch_notes: string | null
          pitched: boolean
          rank: number | null
          recommendations: string[]
          scout_id: string
          shortlisted: boolean
          size_sq_ft: number | null
          source: string
          updated_at: string
          venue_overview: string | null
          venue_type: string | null
          website_url: string | null
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          considerations?: string[]
          created_at?: string
          derived_attrs?: Json
          id?: string
          include_in_deck?: boolean
          key_features?: string[]
          linked_venue_id?: string | null
          name: string
          neighborhood?: string | null
          notes?: string | null
          pitch_notes?: string | null
          pitched?: boolean
          rank?: number | null
          recommendations?: string[]
          scout_id: string
          shortlisted?: boolean
          size_sq_ft?: number | null
          source?: string
          updated_at?: string
          venue_overview?: string | null
          venue_type?: string | null
          website_url?: string | null
        }
        Update: {
          address?: string | null
          capacity?: number | null
          considerations?: string[]
          created_at?: string
          derived_attrs?: Json
          id?: string
          include_in_deck?: boolean
          key_features?: string[]
          linked_venue_id?: string | null
          name?: string
          neighborhood?: string | null
          notes?: string | null
          pitch_notes?: string | null
          pitched?: boolean
          rank?: number | null
          recommendations?: string[]
          scout_id?: string
          shortlisted?: boolean
          size_sq_ft?: number | null
          source?: string
          updated_at?: string
          venue_overview?: string | null
          venue_type?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vs_candidate_venues_linked_venue_id_fkey"
            columns: ["linked_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vs_candidate_venues_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "vs_scouts"
            referencedColumns: ["id"]
          },
        ]
      }
      vs_scouts: {
        Row: {
          archived_at: string | null
          brief_data: Json
          budget: number | null
          city: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          current_step: string
          deck_order: Json
          derived_columns: Json
          event_name: string | null
          event_overview: string | null
          generated_decks: Json
          id: string
          last_touched_at: string
          live_dates: string | null
          name: string
          project_id: string | null
          research_error: string | null
          sheet_storage_path: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          brief_data?: Json
          budget?: number | null
          city?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          current_step?: string
          deck_order?: Json
          derived_columns?: Json
          event_name?: string | null
          event_overview?: string | null
          generated_decks?: Json
          id?: string
          last_touched_at?: string
          live_dates?: string | null
          name: string
          project_id?: string | null
          research_error?: string | null
          sheet_storage_path?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          brief_data?: Json
          budget?: number | null
          city?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          current_step?: string
          deck_order?: Json
          derived_columns?: Json
          event_name?: string | null
          event_overview?: string | null
          generated_decks?: Json
          id?: string
          last_touched_at?: string
          live_dates?: string | null
          name?: string
          project_id?: string | null
          research_error?: string | null
          sheet_storage_path?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vs_scouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vs_scouts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vs_scouts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vs_venue_photos: {
        Row: {
          candidate_venue_id: string
          created_at: string
          file_name: string | null
          file_size_bytes: number | null
          id: string
          slot: number
          storage_path: string
        }
        Insert: {
          candidate_venue_id: string
          created_at?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          slot: number
          storage_path: string
        }
        Update: {
          candidate_venue_id?: string
          created_at?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          slot?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "vs_venue_photos_candidate_venue_id_fkey"
            columns: ["candidate_venue_id"]
            isOneToOne: false
            referencedRelation: "vs_candidate_venues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["permission_role"]
      }
      invoke_edge_function: {
        Args: { body?: Json; fn_name: string }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_producer_or_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      permission_role: "member" | "producer" | "admin"
      project_status:
        | "Quoting"
        | "Quote Sent"
        | "On Hold"
        | "Awaiting FB"
        | "Awaiting Files"
        | "Awaiting Approval"
        | "In Progress"
        | "Complete"
        | "In Production"
        | "Event Live"
        | "Billing"
        | "Proof Out"
        | "Location Scouting"
        | "In Review"
      task_status: "todo" | "in_progress" | "blocked" | "done"
      ts_candidate_attachment_type:
        | "resume"
        | "cover_letter"
        | "portfolio"
        | "email_pdf"
        | "other"
      ts_candidate_portfolio_type: "file" | "url" | "none"
      ts_candidate_status:
        | "consider"
        | "interview"
        | "reject"
        | "fast_track"
        | "auto_rejected"
      ts_final_review_status: "generating" | "complete" | "failed"
      ts_pull_round_status: "running" | "complete" | "failed" | "stalled"
      ts_pull_round_triggered_by: "manual" | "scheduled"
      ts_role_auto_pull_schedule: "off" | "daily" | "every_3_days" | "weekly"
      ts_role_reeval_status: "idle" | "running" | "complete" | "failed"
      ts_role_status: "open" | "closed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      permission_role: ["member", "producer", "admin"],
      project_status: [
        "Quoting",
        "Quote Sent",
        "On Hold",
        "Awaiting FB",
        "Awaiting Files",
        "Awaiting Approval",
        "In Progress",
        "Complete",
        "In Production",
        "Event Live",
        "Billing",
        "Proof Out",
        "Location Scouting",
        "In Review",
      ],
      task_status: ["todo", "in_progress", "blocked", "done"],
      ts_candidate_attachment_type: [
        "resume",
        "cover_letter",
        "portfolio",
        "email_pdf",
        "other",
      ],
      ts_candidate_portfolio_type: ["file", "url", "none"],
      ts_candidate_status: [
        "consider",
        "interview",
        "reject",
        "fast_track",
        "auto_rejected",
      ],
      ts_final_review_status: ["generating", "complete", "failed"],
      ts_pull_round_status: ["running", "complete", "failed", "stalled"],
      ts_pull_round_triggered_by: ["manual", "scheduled"],
      ts_role_auto_pull_schedule: ["off", "daily", "every_3_days", "weekly"],
      ts_role_reeval_status: ["idle", "running", "complete", "failed"],
      ts_role_status: ["open", "closed"],
    },
  },
} as const
