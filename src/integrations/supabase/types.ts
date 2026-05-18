Initialising login role...
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
      cities: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "cities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          id: string
          industry: string | null
          name: string
          primary_address: string | null
          tags: string[]
          updated_at: string
          website_url: string | null
        }
        Insert: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          id?: string
          industry?: string | null
          name: string
          primary_address?: string | null
          tags?: string[]
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          id?: string
          industry?: string | null
          name?: string
          primary_address?: string | null
          tags?: string[]
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey1"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      credentials: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          password: string
          service_name: string
          updated_at: string
          updated_by: string | null
          url: string | null
          username: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          password: string
          service_name: string
          updated_at?: string
          updated_by?: string | null
          url?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          password?: string
          service_name?: string
          updated_at?: string
          updated_by?: string | null
          url?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credentials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverables: {
        Row: {
          assigned_user_ids: string[]
          completed_at: string | null
          created_at: string
          created_by: string
          due_date: string | null
          id: string
          notes: string | null
          project_id: string
          status: Database["public"]["Enums"]["deliverable_status"]
          title: string
          type: string | null
          updated_at: string
        }
        Insert: {
          assigned_user_ids?: string[]
          completed_at?: string | null
          created_at?: string
          created_by: string
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["deliverable_status"]
          title: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          assigned_user_ids?: string[]
          completed_at?: string | null
          created_at?: string
          created_by?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["deliverable_status"]
          title?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_created_by_fkey"
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
      mirror_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mirror_holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      note_mentions: {
        Row: {
          created_at: string
          id: string
          length: number
          mentioned_user_id: string
          note_id: string
          start_offset: number
        }
        Insert: {
          created_at?: string
          id?: string
          length: number
          mentioned_user_id: string
          note_id: string
          start_offset: number
        }
        Update: {
          created_at?: string
          id?: string
          length?: number
          mentioned_user_id?: string
          note_id?: string
          start_offset?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes_log"
            referencedColumns: ["id"]
          },
        ]
      }
      notes_log: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          parent_id: string
          parent_type: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          parent_id: string
          parent_type: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          parent_id?: string
          parent_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_log_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          delivered_email: boolean
          delivered_in_app: boolean
          delivered_slack: boolean
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
          delivered_slack?: boolean
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
          delivered_slack?: boolean
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
      outlook_entries: {
        Row: {
          budget: number | null
          city: string | null
          client_id: string | null
          confidence: Database["public"]["Enums"]["outlook_confidence"]
          created_at: string
          created_by: string
          date_text: string | null
          id: string
          linked_project_id: string | null
          month: number
          name: string
          notes: string | null
          shared_with_team: boolean
          updated_at: string
          week: number
          year: number
        }
        Insert: {
          budget?: number | null
          city?: string | null
          client_id?: string | null
          confidence?: Database["public"]["Enums"]["outlook_confidence"]
          created_at?: string
          created_by: string
          date_text?: string | null
          id?: string
          linked_project_id?: string | null
          month: number
          name: string
          notes?: string | null
          shared_with_team?: boolean
          updated_at?: string
          week: number
          year: number
        }
        Update: {
          budget?: number | null
          city?: string | null
          client_id?: string | null
          confidence?: Database["public"]["Enums"]["outlook_confidence"]
          created_at?: string
          created_by?: string
          date_text?: string | null
          id?: string
          linked_project_id?: string | null
          month?: number
          name?: string
          notes?: string | null
          shared_with_team?: boolean
          updated_at?: string
          week?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "outlook_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlook_entries_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          affiliation_type: Database["public"]["Enums"]["person_affiliation_type"]
          client_id: string | null
          created_at: string
          created_by: string
          email: string | null
          full_name: string
          id: string
          linkedin_url: string | null
          phone: string | null
          role_title: string | null
          tags: string[]
          updated_at: string
          vendor_id: string | null
          venue_id: string | null
        }
        Insert: {
          affiliation_type?: Database["public"]["Enums"]["person_affiliation_type"]
          client_id?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          full_name: string
          id?: string
          linkedin_url?: string | null
          phone?: string | null
          role_title?: string | null
          tags?: string[]
          updated_at?: string
          vendor_id?: string | null
          venue_id?: string | null
        }
        Update: {
          affiliation_type?: Database["public"]["Enums"]["person_affiliation_type"]
          client_id?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          full_name?: string
          id?: string
          linkedin_url?: string | null
          phone?: string | null
          role_title?: string | null
          tags?: string[]
          updated_at?: string
          vendor_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "people_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
      project_categories: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_categories_created_by_fkey"
            columns: ["created_by"]
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
      project_members: {
        Row: {
          created_at: string
          created_by: string | null
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_vendors: {
        Row: {
          created_at: string
          created_by: string | null
          project_id: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          project_id: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          project_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_vendors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_vendors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_vendors_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
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
          budget: number | null
          budget_sheet_url: string | null
          category: string | null
          city: string | null
          client_id: string | null
          client_notes: string | null
          created_at: string
          created_by: string | null
          design_decks_folder_url: string | null
          id: string
          install_dates_end: string | null
          install_dates_start: string | null
          job_number: string | null
          latest_creative_deck_url: string | null
          live_dates_end: string | null
          live_dates_start: string | null
          name: string
          production_folder_url: string | null
          removal_dates_end: string | null
          removal_dates_start: string | null
          slack_channel_url: string | null
          status: Database["public"]["Enums"]["project_status"]
          status_notes: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          budget?: number | null
          budget_sheet_url?: string | null
          category?: string | null
          city?: string | null
          client_id?: string | null
          client_notes?: string | null
          created_at?: string
          created_by?: string | null
          design_decks_folder_url?: string | null
          id?: string
          install_dates_end?: string | null
          install_dates_start?: string | null
          job_number?: string | null
          latest_creative_deck_url?: string | null
          live_dates_end?: string | null
          live_dates_start?: string | null
          name: string
          production_folder_url?: string | null
          removal_dates_end?: string | null
          removal_dates_start?: string | null
          slack_channel_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          status_notes?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          budget?: number | null
          budget_sheet_url?: string | null
          category?: string | null
          city?: string | null
          client_id?: string | null
          client_notes?: string | null
          created_at?: string
          created_by?: string | null
          design_decks_folder_url?: string | null
          id?: string
          install_dates_end?: string | null
          install_dates_start?: string | null
          job_number?: string | null
          latest_creative_deck_url?: string | null
          live_dates_end?: string | null
          live_dates_start?: string | null
          name?: string
          production_folder_url?: string | null
          removal_dates_end?: string | null
          removal_dates_start?: string | null
          slack_channel_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          status_notes?: string | null
          tags?: string[]
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
      saved_views: {
        Row: {
          created_at: string
          entity_type: string
          filter_state: Json
          id: string
          is_default: boolean
          name: string
          scope: string
          updated_at: string
          user_id: string
          view_kind: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          filter_state?: Json
          id?: string
          is_default?: boolean
          name: string
          scope?: string
          updated_at?: string
          user_id: string
          view_kind: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          filter_state?: Json
          id?: string
          is_default?: boolean
          name?: string
          scope?: string
          updated_at?: string
          user_id?: string
          view_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          blocked_by: string[]
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          priority: string
          project_id: string | null
          source_deliverable_id: string | null
          source_user_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          blocked_by?: string[]
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string | null
          source_deliverable_id?: string | null
          source_user_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          blocked_by?: string[]
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string | null
          source_deliverable_id?: string | null
          source_user_id?: string | null
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
          {
            foreignKeyName: "tasks_source_deliverable_id_fkey"
            columns: ["source_deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_user_id_fkey"
            columns: ["source_user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      user_notification_preferences: {
        Row: {
          created_at: string
          id: string
          in_app: boolean
          slack_dm: boolean
          trigger_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          in_app?: boolean
          slack_dm?: boolean
          trigger_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          in_app?: boolean
          slack_dm?: boolean
          trigger_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_preferences_user_id_fkey"
            columns: ["user_id"]
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
          department_id: string | null
          email: string
          full_name: string | null
          id: string
          is_owner: boolean
          last_active_at: string | null
          permission_role: Database["public"]["Enums"]["permission_role"]
          role_title: string | null
          slack_handle: string | null
          slack_user_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email: string
          full_name?: string | null
          id: string
          is_owner?: boolean
          last_active_at?: string | null
          permission_role?: Database["public"]["Enums"]["permission_role"]
          role_title?: string | null
          slack_handle?: string | null
          slack_user_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_owner?: boolean
          last_active_at?: string | null
          permission_role?: Database["public"]["Enums"]["permission_role"]
          role_title?: string | null
          slack_handle?: string | null
          slack_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_capabilities: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_capabilities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_categories: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_files: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          title: string
          url: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
          url: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
          url?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_files_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_files_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_subcategories: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_category_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_category_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_subcategories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_subcategories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "vendor_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          capabilities: string[]
          category_id: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_rating: number | null
          legacy_notes: string | null
          name: string
          preferred: boolean
          primary_address: string | null
          subcategory_id: string | null
          tags: string[]
          updated_at: string
          website_url: string | null
        }
        Insert: {
          capabilities?: string[]
          category_id?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_rating?: number | null
          legacy_notes?: string | null
          name: string
          preferred?: boolean
          primary_address?: string | null
          subcategory_id?: string | null
          tags?: string[]
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          capabilities?: string[]
          category_id?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_rating?: number | null
          legacy_notes?: string | null
          name?: string
          preferred?: boolean
          primary_address?: string | null
          subcategory_id?: string | null
          tags?: string[]
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vendor_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "vendor_subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_contact_people: {
        Row: {
          created_at: string
          person_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          person_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          person_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_contact_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_contact_people_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_rate_history: {
        Row: {
          amount_usd: number
          created_at: string
          created_by: string
          effective_from: string
          id: string
          rate_kind: Database["public"]["Enums"]["venue_rate_kind"]
          venue_id: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          created_by: string
          effective_from?: string
          id?: string
          rate_kind: Database["public"]["Enums"]["venue_rate_kind"]
          venue_id: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          created_by?: string
          effective_from?: string
          id?: string
          rate_kind?: Database["public"]["Enums"]["venue_rate_kind"]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_rate_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_rate_history_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
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
      venue_venue_types: {
        Row: {
          venue_id: string
          venue_type_id: string
        }
        Insert: {
          venue_id: string
          venue_type_id: string
        }
        Update: {
          venue_id?: string
          venue_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_venue_types_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_venue_types_venue_type_id_fkey"
            columns: ["venue_type_id"]
            isOneToOne: false
            referencedRelation: "venue_types"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          capacity: number | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          exclusive_vendor_ids: string[]
          features: string[]
          id: string
          name: string
          neighborhood: string | null
          notes: string | null
          photos: string[]
          square_footage: number | null
          total_sq_ft: number | null
          updated_at: string
          venue_slide_url: string | null
          website_url: string | null
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          exclusive_vendor_ids?: string[]
          features?: string[]
          id?: string
          name: string
          neighborhood?: string | null
          notes?: string | null
          photos?: string[]
          square_footage?: number | null
          total_sq_ft?: number | null
          updated_at?: string
          venue_slide_url?: string | null
          website_url?: string | null
        }
        Update: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          exclusive_vendor_ids?: string[]
          features?: string[]
          id?: string
          name?: string
          neighborhood?: string | null
          notes?: string | null
          photos?: string[]
          square_footage?: number | null
          total_sq_ft?: number | null
          updated_at?: string
          venue_slide_url?: string | null
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
          pipeline_error: string | null
          project_id: string | null
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
          pipeline_error?: string | null
          project_id?: string | null
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
          pipeline_error?: string | null
          project_id?: string | null
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
      wiki_pages: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          id: string
          page_type: string
          slug: string
          sort_order: number
          title: string
          updated_at: string
          updated_by: string | null
          visibility: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          page_type?: string
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
          updated_by?: string | null
          visibility?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          page_type?: string
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "wiki_pages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_pages_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      promote_outlook_to_project: {
        Args: { target_entry_id: string }
        Returns: string
      }
      reset_scout_for_deck_regenerate: {
        Args: { target_scout_id: string }
        Returns: undefined
      }
      start_over_scout: { Args: { target_scout_id: string }; Returns: Json }
    }
    Enums: {
      deliverable_status: "Upcoming" | "Complete" | "Skipped"
      outlook_confidence: "On Radar" | "Likely" | "Confirmed" | "Complete"
      permission_role: "admin" | "standard" | "freelance" | "pending"
      person_affiliation_type: "Client" | "Vendor" | "Venue" | "Unaffiliated"
      project_status:
        | "Approved"
        | "In Production"
        | "In Progress"
        | "Location Scouting"
        | "Install"
        | "Removal"
        | "Billing"
        | "Queued"
        | "Quoting"
        | "Quote Sent"
        | "Awaiting Feedback"
        | "On Hold"
        | "Complete"
        | "Cancelled"
      task_status: "To Do" | "Doing" | "Blocked" | "Done"
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
      venue_rate_kind: "event_day" | "prod_day"
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
      deliverable_status: ["Upcoming", "Complete", "Skipped"],
      outlook_confidence: ["On Radar", "Likely", "Confirmed", "Complete"],
      permission_role: ["admin", "standard", "freelance", "pending"],
      person_affiliation_type: ["Client", "Vendor", "Venue", "Unaffiliated"],
      project_status: [
        "Approved",
        "In Production",
        "In Progress",
        "Location Scouting",
        "Install",
        "Removal",
        "Billing",
        "Queued",
        "Quoting",
        "Quote Sent",
        "Awaiting Feedback",
        "On Hold",
        "Complete",
        "Cancelled",
      ],
      task_status: ["To Do", "Doing", "Blocked", "Done"],
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
      venue_rate_kind: ["event_day", "prod_day"],
    },
  },
} as const
<claude-code-hint v="1" type="plugin" value="supabase@claude-plugins-official" />
A new version of Supabase CLI is available: v2.98.2 (currently installed v2.98.1)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
