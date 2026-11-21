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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      lead_import_codes: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          owner_id: string
          used_at: string | null
          used_run_id: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          owner_id: string
          used_at?: string | null
          used_run_id?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          owner_id?: string
          used_at?: string | null
          used_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_import_codes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "lead_review_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_results: {
        Row: {
          campaign_name: string | null
          checks: Json
          company: string | null
          company_website: string | null
          evidence_url: string | null
          first_seen_at: string
          id: string
          last_run_id: string
          last_seen_at: string
          lead_key: string
          manual_notes: string | null
          manual_score: number | null
          needs_review: boolean
          owner_id: string
          person_name: string | null
          professional_profile: string | null
          qualification_reason: string | null
          review_status: string
          reviewed_at: string | null
          source: string
          title: string | null
        }
        Insert: {
          campaign_name?: string | null
          checks?: Json
          company?: string | null
          company_website?: string | null
          evidence_url?: string | null
          first_seen_at?: string
          id?: string
          last_run_id: string
          last_seen_at?: string
          lead_key: string
          manual_notes?: string | null
          manual_score?: number | null
          needs_review?: boolean
          owner_id: string
          person_name?: string | null
          professional_profile?: string | null
          qualification_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          source?: string
          title?: string | null
        }
        Update: {
          campaign_name?: string | null
          checks?: Json
          company?: string | null
          company_website?: string | null
          evidence_url?: string | null
          first_seen_at?: string
          id?: string
          last_run_id?: string
          last_seen_at?: string
          lead_key?: string
          manual_notes?: string | null
          manual_score?: number | null
          needs_review?: boolean
          owner_id?: string
          person_name?: string | null
          professional_profile?: string | null
          qualification_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          source?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_results_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "lead_review_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_review_owners: {
        Row: {
          auth_issuer: string
          auth_subject: string
          created_at: string
          id: string
        }
        Insert: {
          auth_issuer: string
          auth_subject: string
          created_at?: string
          id?: string
        }
        Update: {
          auth_issuer?: string
          auth_subject?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      lead_runs: {
        Row: {
          campaign_name: string | null
          complete_profiles: number
          imported_at: string
          incomplete_profiles: number
          owner_id: string
          research_company: string | null
          returned_leads: number
          run_id: string
          source: string
        }
        Insert: {
          campaign_name?: string | null
          complete_profiles?: number
          imported_at?: string
          incomplete_profiles?: number
          owner_id: string
          research_company?: string | null
          returned_leads?: number
          run_id: string
          source?: string
        }
        Update: {
          campaign_name?: string | null
          complete_profiles?: number
          imported_at?: string
          incomplete_profiles?: number
          owner_id?: string
          research_company?: string | null
          returned_leads?: number
          run_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_runs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "lead_review_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sightings: {
        Row: {
          campaign_name: string | null
          complete: boolean
          lead_id: string
          owner_id: string
          run_id: string
          seen_at: string
        }
        Insert: {
          campaign_name?: string | null
          complete: boolean
          lead_id: string
          owner_id: string
          run_id: string
          seen_at?: string
        }
        Update: {
          campaign_name?: string | null
          complete?: boolean
          lead_id?: string
          owner_id?: string
          run_id?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_sightings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_sightings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "lead_review_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      openoutfind_ai_budget: {
        Row: {
          budget_day: string
          id: boolean
          paused: boolean
          requests: number
        }
        Insert: {
          budget_day?: string
          id?: boolean
          paused?: boolean
          requests?: number
        }
        Update: {
          budget_day?: string
          id?: boolean
          paused?: boolean
          requests?: number
        }
        Relationships: []
      }
      openoutfind_ai_requests: {
        Row: {
          created_at: string
          fingerprint: string
          run_id: string
          stopped: boolean
        }
        Insert: {
          created_at?: string
          fingerprint: string
          run_id: string
          stopped?: boolean
        }
        Update: {
          created_at?: string
          fingerprint?: string
          run_id?: string
          stopped?: boolean
        }
        Relationships: []
      }
      splee_research_jobs: {
        Row: {
          ai_requests: number
          claim_id: string | null
          created_at: string
          domain: string
          id: string
          owner_id: string
          request_id: string
          revision: number
          state: Json
          updated_at: string
          website_url: string
          working: boolean
        }
        Insert: {
          ai_requests?: number
          claim_id?: string | null
          created_at?: string
          domain: string
          id?: string
          owner_id: string
          request_id: string
          revision?: number
          state?: Json
          updated_at?: string
          website_url: string
          working?: boolean
        }
        Update: {
          ai_requests?: number
          claim_id?: string | null
          created_at?: string
          domain?: string
          id?: string
          owner_id?: string
          request_id?: string
          revision?: number
          state?: Json
          updated_at?: string
          website_url?: string
          working?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      openoutfind_ai_reserve: {
        Args: { p_fingerprint: string; p_run_id: string }
        Returns: string
      }
      openoutfind_ai_stop: {
        Args: { p_pause_all: boolean; p_run_id: string }
        Returns: undefined
      }
      splee_ai_admit: {
        Args: { p_job: string; p_owner: string }
        Returns: string
      }
      splee_claim: {
        Args: {
          p_job: string
          p_owner: string
          p_revision: number
          p_state: Json
        }
        Returns: Json
      }
      splee_finish: {
        Args: { p_claim: string; p_job: string; p_owner: string; p_state: Json }
        Returns: Json
      }
      splee_start: {
        Args: {
          p_domain: string
          p_owner: string
          p_request: string
          p_state: Json
          p_url: string
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
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
