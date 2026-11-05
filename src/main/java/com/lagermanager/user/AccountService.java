package com.lagermanager.user;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
public class AccountService {
    private final UserRepository users;
    public AccountService(UserRepository users) { this.users = users; }

    public record Account(Long id, String email, Role role, boolean enabled) {
        public static Account from(User user) {
            return new Account(user.getId(), user.getEmail(), user.getRole(), user.isEnabled());
        }
    }

    public List<Account> list() {
        return users.findAll(org.springframework.data.domain.Sort.by("email")).stream().map(Account::from).toList();
    }

    @Transactional
    public Account update(Long id, Role role, boolean enabled) {
        User user = users.findByIdForUpdate(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found"));
        user.setRole(role);
        user.setEnabled(enabled);
        // Email and password are deliberately immutable through account management.
        return Account.from(users.saveAndFlush(user));
    }
}
