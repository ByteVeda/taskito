package org.byteveda.taskito.dashboard.auth;

/**
 * A dashboard user. {@code createdAt}/{@code lastLoginAt} are Unix
 * milliseconds. {@code email}/{@code displayName} are populated for OAuth users
 * only. Password users have a {@code pbkdf2_sha256$...} {@code passwordHash};
 * OAuth users have the {@code oauth:<slot>} sentinel.
 */
public record User(
        String username,
        String passwordHash,
        String role,
        long createdAt,
        Long lastLoginAt,
        String email,
        String displayName) {

    public boolean isOauth() {
        return PasswordHasher.isOauth(passwordHash);
    }
}
