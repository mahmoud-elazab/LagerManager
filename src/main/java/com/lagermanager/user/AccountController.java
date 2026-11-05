package com.lagermanager.user;

import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {
    private final AccountService accounts;
    private final AccountCreationService creation;
    public AccountController(AccountService accounts, AccountCreationService creation) {
        this.accounts = accounts;
        this.creation = creation;
    }

    @GetMapping
    public List<AccountService.Account> list() { return accounts.list(); }

    @PostMapping
    public ResponseEntity<AccountService.Account> create(@RequestBody JsonNode body) {
        Role role = role(body);
        boolean enabled = enabled(body);
        User user = creation.create(text(body, "email"), text(body, "password"), role, enabled);
        return ResponseEntity.status(201).body(AccountService.Account.from(user));
    }

    @PutMapping("/{id}")
    public AccountService.Account update(@PathVariable Long id, @RequestBody JsonNode body) {
        if (id <= 0) throw new IllegalArgumentException();
        return accounts.update(id, role(body), enabled(body));
    }

    private String text(JsonNode body, String field) {
        JsonNode value = body == null ? null : body.get(field);
        return value != null && value.isString() ? value.asString() : null;
    }
    private Role role(JsonNode body) {
        String value = text(body, "role");
        if (value == null) throw new IllegalArgumentException();
        return Role.valueOf(value);
    }
    private boolean enabled(JsonNode body) {
        JsonNode value = body == null ? null : body.get("enabled");
        if (value == null || !value.isBoolean()) throw new IllegalArgumentException();
        return value.booleanValue();
    }

    @ExceptionHandler(AccountCreationService.CreationException.class)
    public ResponseEntity<?> creationFailure(AccountCreationService.CreationException failure) {
        return ResponseEntity.status(failure.status()).body(Map.of("error", failure.getMessage()));
    }
    @ExceptionHandler({IllegalArgumentException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<?> invalid() {
        return ResponseEntity.badRequest().body(Map.of("error", "Enter valid account details, a role and a true/false enabled status."));
    }
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<?> notFound(ResponseStatusException failure) {
        return ResponseEntity.status(failure.getStatusCode()).body(Map.of("error", "Account not found."));
    }
}
