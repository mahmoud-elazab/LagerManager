package com.lagermanager.auth;

import com.lagermanager.user.AccountCreationService;
import com.lagermanager.user.Role;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth/register")
public class RegistrationController {
    private final AccountCreationService accounts;

    public RegistrationController(AccountCreationService accounts) {
        this.accounts = accounts;
    }

    public record RegistrationRequest(String email, String password, Role role) { }

    @PostMapping
    public ResponseEntity<?> register(@RequestBody RegistrationRequest request) {
        if (request == null) return invalid();
        accounts.create(request.email(), request.password(), request.role(), true);
        return ResponseEntity.status(201).body(Map.of("email", request.email()));
    }

    @ExceptionHandler(AccountCreationService.CreationException.class)
    public ResponseEntity<?> creationFailure(AccountCreationService.CreationException failure) {
        return ResponseEntity.status(failure.status()).body(Map.of("error", failure.getMessage()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<?> invalid() {
        return ResponseEntity.badRequest().body(Map.of("error", AccountCreationService.INVALID_INPUT));
    }
}
