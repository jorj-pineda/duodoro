export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      friendships: {
        Row: {
          addressee_id: string
          created_at: string | null
          id: string
          requester_id: string
          status: string | null
        }
        Insert: {
          addressee_id: string
          created_at?: string | null
          id?: string
          requester_id: string
          status?: string | null
        }
        Update: {
          addressee_id?: string
          created_at?: string | null
          id?: string
          requester_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_grants: {
        Row: {
          email: string
          granted_at: string
          marketing_opt_in: boolean
          source: string
          user_id: string
        }
        Insert: {
          email: string
          granted_at?: string
          marketing_opt_in?: boolean
          source?: string
          user_id: string
        }
        Update: {
          email?: string
          granted_at?: string
          marketing_opt_in?: boolean
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_config: Json | null
          current_room: string | null
          current_session_id: string | null
          current_world_id: string | null
          discriminator: string
          display_name: string | null
          display_name_changed_at: string | null
          id: string
          is_premium: boolean | null
          updated_at: string | null
          username: string
          username_changed: boolean | null
        }
        Insert: {
          avatar_config?: Json | null
          current_room?: string | null
          current_session_id?: string | null
          current_world_id?: string | null
          discriminator: string
          display_name?: string | null
          display_name_changed_at?: string | null
          id: string
          is_premium?: boolean | null
          updated_at?: string | null
          username: string
          username_changed?: boolean | null
        }
        Update: {
          avatar_config?: Json | null
          current_room?: string | null
          current_session_id?: string | null
          current_world_id?: string | null
          discriminator?: string
          display_name?: string | null
          display_name_changed_at?: string | null
          id?: string
          is_premium?: boolean | null
          updated_at?: string | null
          username?: string
          username_changed?: boolean | null
        }
        Relationships: []
      }
      session_focus_tags: {
        Row: {
          created_at: string
          session_id: string
          tag: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          session_id: string
          tag?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          session_id?: string
          tag?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "session_focus_tags_participant_fk"
            columns: ["session_id", "user_id"]
            isOneToOne: true
            referencedRelation: "session_participants"
            referencedColumns: ["session_id", "user_id"]
          },
        ]
      }
      session_participants: {
        Row: {
          created_at: string | null
          id: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_reflections: {
        Row: {
          created_at: string
          reflection_text: string
          session_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          reflection_text: string
          session_id: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          reflection_text?: string
          session_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "session_reflections_participant_fk"
            columns: ["session_id", "user_id"]
            isOneToOne: true
            referencedRelation: "session_participants"
            referencedColumns: ["session_id", "user_id"]
          },
        ]
      }
      sessions: {
        Row: {
          actual_focus: number
          break_duration: number
          completed: boolean | null
          ended_at: string | null
          focus_duration: number
          id: string
          recording_key: string | null
          room_code: string
          started_at: string
          world: string
        }
        Insert: {
          actual_focus: number
          break_duration: number
          completed?: boolean | null
          ended_at?: string | null
          focus_duration: number
          id?: string
          recording_key?: string | null
          room_code: string
          started_at: string
          world?: string
        }
        Update: {
          actual_focus?: number
          break_duration?: number
          completed?: boolean | null
          ended_at?: string | null
          focus_duration?: number
          id?: string
          recording_key?: string | null
          room_code?: string
          started_at?: string
          world?: string
        }
        Relationships: []
      }
      shared_daily_goals: {
        Row: {
          accepted: boolean
          created_at: string
          created_by: string
          friendship_id: string
          id: string
          target_minutes: number
          timezone: string
        }
        Insert: {
          accepted?: boolean
          created_at?: string
          created_by: string
          friendship_id: string
          id?: string
          target_minutes: number
          timezone: string
        }
        Update: {
          accepted?: boolean
          created_at?: string
          created_by?: string
          friendship_id?: string
          id?: string
          target_minutes?: number
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_daily_goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_daily_goals_friendship_id_fkey"
            columns: ["friendship_id"]
            isOneToOne: true
            referencedRelation: "friendships"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_by: string | null
          content: string
          created_at: string | null
          id: string
          is_done: boolean | null
          is_shared: boolean | null
          owner_id: string
          room_code: string | null
          session_id: string | null
        }
        Insert: {
          completed_by?: string | null
          content: string
          created_at?: string | null
          id?: string
          is_done?: boolean | null
          is_shared?: boolean | null
          owner_id: string
          room_code?: string | null
          session_id?: string | null
        }
        Update: {
          completed_by?: string | null
          content?: string
          created_at?: string | null
          id?: string
          is_done?: boolean | null
          is_shared?: boolean | null
          owner_id?: string
          room_code?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string | null
          email: string
          id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_shared_daily_goal: { Args: { goal_id: string }; Returns: string }
      assert_focus_tag_session_eligible: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      assert_reflection_session_eligible: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      change_display_name: { Args: { new_name: string }; Returns: Json }
      check_session_reflection_text: {
        Args: { p_text: string }
        Returns: undefined
      }
      claim_premium: {
        Args: { p_marketing_opt_in?: boolean }
        Returns: {
          email: string
          granted_at: string
          marketing_opt_in: boolean
          source: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "premium_grants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_username: { Args: { desired_username: string }; Returns: Json }
      create_session_reflection: {
        Args: { p_session_id: string; p_text: string }
        Returns: {
          created_at: string
          reflection_text: string
          session_id: string
          updated_at: string
          user_id: string
          version: number
        }[]
      }
      create_shared_daily_goal: {
        Args: { friend_id: string; minutes: number; tz: string }
        Returns: string
      }
      delete_session_reflection: {
        Args: { p_expected_version: number; p_session_id: string }
        Returns: {
          deleted_version: number
          session_id: string
          user_id: string
        }[]
      }
      generate_discriminator: {
        Args: { base_username: string }
        Returns: string
      }
      get_daily_focus: {
        Args: { days?: number; tz?: string }
        Returns: {
          day: string
          focus_seconds: number
          session_count: number
        }[]
      }
      get_duo_stats: {
        Args: never
        Returns: {
          partner_id: string
          partner_name: string
          sessions_together: number
          total_co_focus_time: number
        }[]
      }
      get_focus_calendar: {
        Args: { month_start: string; tz?: string }
        Returns: {
          day: string
          duo_rounds: number
          duo_seconds: number
          sessions: Json
          solo_rounds: number
          solo_seconds: number
        }[]
      }
      get_focus_stats: {
        Args: { tz?: string }
        Returns: {
          avg_session_length: number
          current_streak: number
          longest_streak: number
          sessions_completed: number
          total_focus_time: number
          weekly_focus_time: number
        }[]
      }
      get_recent_sessions: {
        Args: { lim?: number }
        Returns: {
          actual_focus: number
          break_duration: number
          completed: boolean
          ended_at: string
          focus_duration: number
          id: string
          partner_id: string
          partner_name: string
          room_code: string
          started_at: string
          world: string
        }[]
      }
      get_shared_daily_goals: {
        Args: never
        Returns: {
          accepted: boolean
          created_by: string
          day: string
          id: string
          my_seconds: number
          partner_id: string
          partner_name: string
          partner_seconds: number
          resets_at: string
          target_minutes: number
          timezone: string
        }[]
      }
      get_weekly_duo_recap: {
        Args: { tz?: string }
        Returns: {
          completed_rounds: number
          focus_seconds: number
          partner_id: string
          partner_name: string
          week_end: string
          week_start: string
        }[]
      }
      is_session_participant: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      list_accepted_friend_ids: { Args: { target: string }; Returns: string[] }
      record_focus_session: {
        Args: {
          p_actual_focus: number
          p_break_duration: number
          p_completed: boolean
          p_focus_duration: number
          p_recording_key: string
          p_room_code: string
          p_started_at: string
          p_user_ids: string[]
          p_world: string
        }
        Returns: {
          inserted: boolean
          session_id: string
        }[]
      }
      search_profiles: {
        Args: { query: string }
        Returns: {
          discriminator: string
          display_name: string
          id: string
          is_premium: boolean
          username: string
        }[]
      }
      set_session_focus_tag: {
        Args: {
          p_expected_version: number
          p_session_id: string
          p_tag: string
        }
        Returns: {
          session_id: string
          tag: string
          updated_at: string
          user_id: string
          version: number
        }[]
      }
      toggle_shared_task: {
        Args: { p_done: boolean; p_task_id: string }
        Returns: {
          completed_by: string | null
          content: string
          created_at: string | null
          id: string
          is_done: boolean | null
          is_shared: boolean | null
          owner_id: string
          room_code: string | null
          session_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      total_focus_seconds: { Args: { target: string }; Returns: number }
      update_session_reflection: {
        Args: {
          p_expected_version: number
          p_session_id: string
          p_text: string
        }
        Returns: {
          created_at: string
          reflection_text: string
          session_id: string
          updated_at: string
          user_id: string
          version: number
        }[]
      }
      update_shared_daily_goal: {
        Args: { goal_id: string; minutes: number }
        Returns: string
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
    Enums: {},
  },
} as const

