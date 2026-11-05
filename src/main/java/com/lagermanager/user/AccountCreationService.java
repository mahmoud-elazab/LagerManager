package com.lagermanager.user;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;

@Service
public class AccountCreationService {
    public static final String INVALID_INPUT = "Enter a valid email, a nonblank password of at most 72 UTF-8 bytes, and Admin, Manager or Employee role.";
    private final UserRepository users;
    private final PasswordEncoder passwords;

    public AccountCreationService(UserRepository users, PasswordEncoder passwords) {
        this.users = users;
        this.passwords = passwords;
    }

    public User create(String email, String password, Role role, boolean enabled) {
        if (email == null || email.length() > 255 || !email.matches("[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+")
                || password == null || password.isBlank()
                || password.getBytes(StandardCharsets.UTF_8).length > 72 || role == null) {
            throw new CreationException(400, INVALID_INPUT);
        }
        if (users.findByEmail(email).isPresent()) throw duplicate();
        try {
            // Always insert; the unique constraint also handles concurrent duplicate registrations.
            return users.saveAndFlush(new User(null, email, passwords.encode(password), role, enabled));
        } catch (DataIntegrityViolationException conflict) {
            if (users.findByEmail(email).isPresent()) throw duplicate();
            throw conflict;
        }
    }

    private CreationException duplicate() {
        return new CreationException(409, "An account with this email already exists.");
    }

    public static class CreationException extends RuntimeException {
        private final int status;
        public CreationException(int status, String message) { super(message); this.status = status; }
        public int status() { return status; }
    }
}
