package org.byteveda.taskito.dashboard.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.byteveda.taskito.dashboard.InMemorySettings;
import org.byteveda.taskito.dashboard.support.DashboardError;
import org.junit.jupiter.api.Test;

class AuthStoreTest {

    private AuthStore store() {
        return new AuthStore(new InMemorySettings());
    }

    @Test
    void createsAndAuthenticatesUsers() {
        AuthStore store = store();
        assertEquals(0, store.countUsers());
        User user = store.createUser("alice", "password123", "admin");
        assertEquals("alice", user.username());
        assertEquals("admin", user.role());
        assertNull(user.lastLoginAt());
        assertEquals(1, store.countUsers());

        assertNotNull(store.authenticate("alice", "password123"));
        assertNull(store.authenticate("alice", "wrong"));
        assertNull(store.authenticate("ghost", "password123"));

        // last-login stamped on success (milliseconds).
        User reloaded = store.getUser("alice").orElseThrow();
        assertNotNull(reloaded.lastLoginAt());
        assertTrue(reloaded.lastLoginAt() > 1_000_000_000_000L);
    }

    @Test
    void rejectsDuplicatesAndInvalidInput() {
        AuthStore store = store();
        store.createUser("bob", "password123", "admin");
        assertThrows(DashboardError.class, () -> store.createUser("bob", "password123", "admin"));
        assertThrows(DashboardError.class, () -> store.createUser("bad name", "password123", "admin"));
        assertThrows(DashboardError.class, () -> store.createUser("carol", "short", "admin"));
        assertThrows(DashboardError.class, () -> store.createUser("carol", "password123", "superuser"));
    }

    @Test
    void sessionsUseSecondsAndExpire() {
        AuthStore store = store();
        Session session = store.createSession("alice", "admin");
        assertEquals(AuthStore.DEFAULT_SESSION_TTL_SECONDS, session.expiresAt() - session.createdAt());
        assertTrue(session.createdAt() < 1_000_000_000_000L); // seconds, not millis
        assertTrue(store.getSession(session.token()).isPresent());

        Session expired = store.createSession("alice", "admin", -10);
        assertTrue(store.getSession(expired.token()).isEmpty());
    }

    @Test
    void prunesExpiredSessions() {
        AuthStore store = store();
        Session valid = store.createSession("alice", "admin", 3600);
        store.createSession("alice", "admin", -10);
        assertEquals(1, store.pruneExpiredSessions());
        assertTrue(store.getSession(valid.token()).isPresent());
    }

    @Test
    void deletingUserClearsSessions() {
        AuthStore store = store();
        store.createUser("alice", "password123", "admin");
        Session session = store.createSession("alice", "admin");
        store.deleteUser("alice");
        assertEquals(0, store.countUsers());
        assertTrue(store.getSession(session.token()).isEmpty());
    }

    @Test
    void oauthBootstrapRolePrecedence() {
        // Unverified / missing email never becomes admin.
        assertEquals("viewer", AuthStore.oauthBootstrapRole("a@x.com", false, List.of()));
        assertEquals("viewer", AuthStore.oauthBootstrapRole(null, true, List.of()));
        // Admin-email list is the only path to admin (case-insensitive).
        assertEquals("admin", AuthStore.oauthBootstrapRole("A@X.com", true, List.of("a@x.com")));
        assertEquals("viewer", AuthStore.oauthBootstrapRole("b@x.com", true, List.of("a@x.com")));
        // No admin list: everyone — including the first user — is a viewer.
        assertEquals("viewer", AuthStore.oauthBootstrapRole("c@x.com", true, List.of()));
    }

    @Test
    void getOrCreateOauthUserProvisionsThenRefreshes() {
        AuthStore store = store();
        User created = store.getOrCreateOauthUser("google", "123", "a@x.com", "Ann", true, List.of("a@x.com"));
        assertEquals("google:123", created.username());
        assertEquals("admin", created.role()); // allowlisted
        assertTrue(created.isOauth());

        User refreshed = store.getOrCreateOauthUser("google", "123", "new@x.com", "Ann N", true, List.of("z@x.com"));
        assertEquals("google:123", refreshed.username());
        assertEquals("admin", refreshed.role()); // role preserved
        assertEquals("new@x.com", refreshed.email());
        assertEquals(1, store.countUsers());
    }

    @Test
    void envBootstrapIsIdempotent() {
        AuthStore store = store();
        Map<String, String> env = Map.of(
                AuthStore.ENV_ADMIN_USER, "root",
                AuthStore.ENV_ADMIN_PASSWORD, "password123");
        store.bootstrapAdminFromEnv(env);
        assertEquals(1, store.countUsers());
        store.bootstrapAdminFromEnv(env);
        assertEquals(1, store.countUsers());
        assertNotNull(store.authenticate("root", "password123"));

        AuthStore empty = store();
        empty.bootstrapAdminFromEnv(Map.of());
        assertEquals(0, empty.countUsers());
    }

    @Test
    void changePasswordInvalidatesOldCredential() {
        AuthStore store = store();
        store.createUser("alice", "password123", "admin");
        Session existing = store.createSession("alice", "admin");
        store.updatePassword("alice", "new-password!");
        assertNull(store.authenticate("alice", "password123"));
        assertNotNull(store.authenticate("alice", "new-password!"));
        // Sessions from before the change are revoked.
        assertTrue(store.getSession(existing.token()).isEmpty());
        assertFalse(store.getSession("missing").isPresent());
    }
}
