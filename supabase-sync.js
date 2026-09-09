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
      this.presenceChannel = null;
      this.presenceActorId = null;
      this.presenceSubscribed = false;
      this.presenceSessionId = this.createPresenceSessionId();
      this.presenceActivityStarted = false;
      this.presenceHeartbeat = null;
    }

    createPresenceSessionId() {
      return window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

    async keepAlive() {
      const { data, error } = await this.client.rpc("cast_keep_alive", { p_slug: this.slug });
      if (error) throw error;
      return data;
    }

    async getPresenceActivity(days = 7) {
      const { data, error } = await this.client.rpc("cast_presence_activity", {
        p_slug: this.slug,
        p_days: Math.max(1, Math.min(14, Number(days) || 7))
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
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

    async uploadVoiceClip(roleId, file) {
      const safeName = String(file?.name || "sample")
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "sample";
      const unique = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `${this.slug}/${roleId}/${unique}-${safeName}`;
      const { error } = await this.client.storage
        .from("voice-clips")
        .upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
      if (error) throw error;
      const { data } = this.client.storage.from("voice-clips").getPublicUrl(path);
      if (!data?.publicUrl) throw new Error("The uploaded voice sample has no public URL.");
      return { path, url: data.publicUrl };
    }

    async removeVoiceClip(path) {
      const { error } = await this.client.storage.from("voice-clips").remove([path]);
      if (error) throw error;
      return true;
    }

    async uploadPracticeRecording(actorId, roleId, blob, extension = "webm") {
      const unique = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `${this.slug}/personal/${actorId}/${roleId}/${unique}.${extension}`;
      const { error } = await this.client.storage
        .from("voice-clips")
        .upload(path, blob, { contentType: blob.type || "audio/webm", upsert: false });
      if (error) throw error;
      const { data } = this.client.storage.from("voice-clips").getPublicUrl(path);
      if (!data?.publicUrl) throw new Error("The saved recording has no public URL.");
      return { path, url: data.publicUrl };
    }

    async removePracticeRecording(path) {
      return this.removeVoiceClip(path);
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

    subscribePresence(actorId, onPresence, onStatus) {
      if (this.presenceChannel) this.client.removeChannel(this.presenceChannel);
      this.presenceActorId = actorId || null;
      this.presenceSubscribed = false;
      const emitPresence = () => {
        const presenceState = this.presenceChannel?.presenceState?.() || {};
        const actorIds = new Set();
        Object.values(presenceState).flat().forEach(entry => {
          if (entry?.actor_id) actorIds.add(String(entry.actor_id));
        });
        onPresence?.([...actorIds]);
      };
      this.presenceChannel = this.client
        .channel(`cast-presence-${this.slug}`, {
          config: { presence: { key: this.presenceSessionId } }
        })
        .on("presence", { event: "sync" }, emitPresence)
        .on("presence", { event: "join" }, emitPresence)
        .on("presence", { event: "leave" }, emitPresence)
        .subscribe(async status => {
          onStatus?.(status);
          this.presenceSubscribed = status === "SUBSCRIBED";
          if (status === "SUBSCRIBED" && this.presenceActorId) {
            await this.startPresenceActivity().catch(error => {
              console.warn("Presence history unavailable:", messageOf(error));
            });
            await this.presenceChannel.track({
              actor_id: this.presenceActorId,
              online_at: new Date().toISOString()
            });
          }
        });
    }

    async startPresenceActivity() {
      if (!this.presenceActorId || this.presenceActivityStarted) return false;
      const { error } = await this.client.rpc("cast_presence_start", {
        p_slug: this.slug,
        p_actor_id: this.presenceActorId,
        p_session_id: this.presenceSessionId
      });
      if (error) throw error;
      this.presenceActivityStarted = true;
      clearInterval(this.presenceHeartbeat);
      this.presenceHeartbeat = setInterval(() => {
        this.touchPresenceActivity(false).catch(error => {
          console.warn("Presence heartbeat unavailable:", messageOf(error));
        });
      }, 30000);
      this.presenceHeartbeat?.unref?.();
      return true;
    }

    async touchPresenceActivity(ended = false) {
      if (!this.presenceActorId || !this.presenceActivityStarted) return false;
      const { error } = await this.client.rpc("cast_presence_touch", {
        p_slug: this.slug,
        p_actor_id: this.presenceActorId,
        p_session_id: this.presenceSessionId,
        p_ended: !!ended
      });
      if (error) throw error;
      if (ended) {
        clearInterval(this.presenceHeartbeat);
        this.presenceHeartbeat = null;
        this.presenceActivityStarted = false;
      }
      return true;
    }

    async endPresenceSession() {
      return this.touchPresenceActivity(true);
    }

    async setPresenceActor(actorId) {
      const nextActorId = actorId || null;
      if (this.presenceActorId && this.presenceActorId !== nextActorId) {
        await this.endPresenceSession().catch(error => {
          console.warn("Presence session close unavailable:", messageOf(error));
        });
      }
      if (this.presenceActorId !== nextActorId) {
        this.presenceSessionId = this.createPresenceSessionId();
        this.presenceActivityStarted = false;
      }
      this.presenceActorId = nextActorId;
      if (!this.presenceChannel || !this.presenceSubscribed) return false;
      if (!this.presenceActorId) {
        await this.presenceChannel.untrack();
        return true;
      }
      await this.startPresenceActivity().catch(error => {
        console.warn("Presence history unavailable:", messageOf(error));
      });
      await this.presenceChannel.track({
        actor_id: this.presenceActorId,
        online_at: new Date().toISOString()
      });
      return true;
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
