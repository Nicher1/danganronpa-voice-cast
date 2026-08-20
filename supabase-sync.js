(function () {
  "use strict";

  function messageOf(error) {
    return error?.message || error?.details || String(error || "Unknown Supabase error");
  }

  class CastSupabaseSync {
    constructor(config) {
      if (!config?.url || !config?.publishableKey || !config?.boardSlug) {
        throw new Error("Supabase configuration is incomplete.");
      }
      if (!window.supabase?.createClient) {
        throw new Error("The Supabase client library did not load.");
      }

      this.slug = config.boardSlug;
      this.client = window.supabase.createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      this.channel = null;
    }

    async ensureAnonymousUser() {
      const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session?.user) return sessionData.session.user;

      const { data, error } = await this.client.auth.signInAnonymously();
      if (error) throw error;
      return data.user;
    }

    async getBoard(fullState = false) {
      const table = fullState ? "cast_boards" : "cast_public_boards";
      const { data, error } = await this.client
        .from(table)
        .select("slug,state,revision,initialized,updated_at")
        .eq("slug", this.slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    }

    async isHost() {
      const { data, error } = await this.client.rpc("cast_is_host", { p_slug: this.slug });
      if (error) throw error;
      return data === true;
    }

    async initializeBoard(setupCode, hostPassword, initialState) {
      const { data, error } = await this.client.rpc("cast_initialize_board", {
        p_slug: this.slug,
        p_setup_code: setupCode,
        p_host_password: hostPassword,
        p_initial_state: initialState
      });
      if (error) throw error;
      return data;
    }

    async loginHost(password) {
      const { data, error } = await this.client.rpc("cast_login_host", {
        p_slug: this.slug,
        p_password: password
      });
      if (error) throw error;
      return data === true;
    }

    async claimActor(actorId, password = "") {
      const { data, error } = await this.client.rpc("cast_claim_actor", {
        p_slug: this.slug,
        p_actor_id: actorId,
        p_password: password
      });
      if (error) throw error;
      return data === true;
    }

    async registerActor(actorId, password = "") {
      const { data, error } = await this.client.rpc("cast_register_actor", {
        p_slug: this.slug,
        p_actor_id: actorId,
        p_password: password
      });
      if (error) throw error;
      return data === true;
    }

    async setActorPassword(actorId, password) {
      const { data, error } = await this.client.rpc("cast_set_actor_password", {
        p_slug: this.slug,
        p_actor_id: actorId,
        p_password: password
      });
      if (error) throw error;
      return data;
    }

    async saveBoard(state, expectedRevision) {
      const { data, error } = await this.client.rpc("cast_save_board", {
        p_slug: this.slug,
        p_state: state,
        p_expected_revision: expectedRevision
      });
      if (error) throw error;
      return data;
    }

    subscribe(fullState, onBoard, onStatus) {
      if (this.channel) this.client.removeChannel(this.channel);
      const table = fullState ? "cast_boards" : "cast_public_boards";
      this.channel = this.client
        .channel(`cast-board-${this.slug}-${fullState ? "host" : "public"}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table,
            filter: `slug=eq.${this.slug}`
          },
          payload => onBoard(payload.new)
        )
        .subscribe(status => onStatus?.(status));
    }

    async refresh(fullState = false) {
      return this.getBoard(fullState);
    }

    static errorMessage(error) {
      return messageOf(error);
    }
  }

  window.CastSupabaseSync = CastSupabaseSync;
})();
