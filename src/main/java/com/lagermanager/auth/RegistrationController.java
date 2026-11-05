package com.lagermanager.auth;

import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import com.lagermanager.user.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.Map;

@RestController
@RequestMapping("/api/auth/register")
public class RegistrationController {
    private final UserRepository users;
    private final PasswordEncoder passwords;

    public RegistrationController(UserRepository users, PasswordEncoder passwords) {
        this.users = users;
        this.passwords = passwords;
    }

    public record RegistrationRequest(String email, String password, Role role) { }

    @PostMapping
    public ResponseEntity<?> register(@RequestBody RegistrationRequest request) {
        if (request == null || request.email() == null || request.email().length() > 255
                || !request.email().matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")
                || request.password() == null || request.password().isBlank()
                || request.password().getBytes(StandardCharsets.UTF_8).length > 72 || request.role() == null) {
            return invalid();
        }
        if (users.findByEmail(request.email()).isPresent()) return duplicate();
        try {
            // Always insert a fresh entity. The unique constraint also protects concurrent registrations.
            users.saveAndFlush(new User(null, request.email(), passwords.encode(request.password()),
                    request.role(), true));
        } catch (DataIntegrityViolationException conflict) {
            if (users.findByEmail(request.email()).isPresent()) return duplicate();
            throw conflict;
        }
        return ResponseEntity.status(201).body(Map.of("email", request.email()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<?> invalid() {
        return ResponseEntity.badRequest().body(Map.of("error",
                "Enter a valid email, a nonblank password of at most 72 UTF-8 bytes, and Admin, Manager or Employee role."));
    }

    private ResponseEntity<?> duplicate() {
        return ResponseEntity.status(409).body(Map.of("error", "An account with this email already exists."));
    }
}
