package com.lagermanager.auth;

import com.lagermanager.security.CustomUserDetailsService;
import com.lagermanager.security.SecurityConfig;
import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import com.lagermanager.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthenticationServiceTests {

    private UserRepository userRepository;
    private PasswordEncoder passwordEncoder;
    private AuthenticationService authenticationService;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        SecurityConfig config = new SecurityConfig();
        passwordEncoder = config.passwordEncoder();
        CustomUserDetailsService userDetailsService = new CustomUserDetailsService(userRepository);
        authenticationService = new AuthenticationService(config.authenticationManager(
                config.authenticationProvider(userDetailsService, passwordEncoder)));
    }

    @Test
    void correctPasswordAuthenticates() {
        givenUser(true);

        Authentication result = authenticationService.authenticate("test@example.com", "test-password");

        assertTrue(result.isAuthenticated());
        assertEquals("test@example.com", result.getName());
        assertTrue(result.getAuthorities().contains(new SimpleGrantedAuthority("ROLE_EMPLOYEE")));
        assertNull(result.getCredentials());
    }

    @Test
    void incorrectPasswordIsRejected() {
        givenUser(true);

        assertThrows(BadCredentialsException.class,
                () -> authenticationService.authenticate("test@example.com", "incorrect-password"));
    }

    @Test
    void disabledAccountIsRejected() {
        givenUser(false);

        assertThrows(DisabledException.class,
                () -> authenticationService.authenticate("test@example.com", "test-password"));
    }

    private void givenUser(boolean enabled) {
        User user = new User(1L, "test@example.com", passwordEncoder.encode("test-password"),
                Role.EMPLOYEE, enabled);
        when(userRepository.findByEmail("test@example.com")).thenReturn(Optional.of(user));
    }
}
