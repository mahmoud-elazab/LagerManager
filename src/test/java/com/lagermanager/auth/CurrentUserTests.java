package com.lagermanager.auth;

import com.lagermanager.security.CustomUserDetailsService;
import com.lagermanager.security.JwtService;
import com.lagermanager.security.SecurityConfig;
import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import com.lagermanager.user.UserRepository;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import javax.crypto.SecretKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Optional;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup;

class CurrentUserTests {

    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    private UserRepository repository;
    private JwtService jwtService;

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        mvc = webAppContextSetup(context).addFilters(context.getBean(FilterChainProxy.class)).build();
        repository = context.getBean(UserRepository.class);
        jwtService = context.getBean(JwtService.class);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        context.close();
    }

    @ParameterizedTest
    @EnumSource(Role.class)
    void returnsOnlyCurrentEmailAndRoleForEachRole(Role role) throws Exception {
        User user = givenUser(role);
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + jwtService.generateToken(user)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(user.getEmail()))
                .andExpect(jsonPath("$.role").value(role.name()))
                .andExpect(jsonPath("$.length()").value(2));
        verify(repository, never()).save(any());
    }

    @Test
    void existingTokenUsesCurrentDatabaseRoleAndIgnoresClientIdentity() throws Exception {
        User user = givenUser(Role.EMPLOYEE);
        String token = jwtService.generateToken(user);
        for (Role currentRole : Role.values()) {
            user.setRole(currentRole);
            mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)
                            .param("email", "someone-else@example.com").param("role", "ADMIN"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.email").value(user.getEmail()))
                    .andExpect(jsonPath("$.role").value(currentRole.name()))
                    .andExpect(jsonPath("$.length()").value(2));
        }
        verify(repository, never()).findByEmail("someone-else@example.com");
    }

    @Test
    void missingAuthenticationReturns401() throws Exception {
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        verifyNoInteractions(repository);
    }

    @Test
    void invalidTokenReturns401() throws Exception {
        expectUnauthorized("invalid");
        verifyNoInteractions(repository);
    }

    @Test
    void signatureFromAnotherKeyReturns401() throws Exception {
        User user = givenUser(Role.ADMIN);
        JwtService otherSigner = new JwtService(Base64.getEncoder().encodeToString(
                Jwts.SIG.HS256.key().build().getEncoded()));
        expectUnauthorized(otherSigner.generateToken(user));
        verify(repository, never()).findByEmail(anyString());
    }

    @Test
    void expiredTokenReturns401() throws Exception {
        String token = Jwts.builder().subject("fictional@example.com")
                .expiration(Date.from(Instant.now().minusSeconds(60)))
                .signWith(context.getBean(SecretKey.class), Jwts.SIG.HS256).compact();
        expectUnauthorized(token);
        verifyNoInteractions(repository);
    }

    @Test
    void unknownUserReturns401() throws Exception {
        User user = new User();
        user.setEmail("unknown@example.com");
        user.setRole(Role.EMPLOYEE);
        expectUnauthorized(jwtService.generateToken(user));
    }

    @Test
    void disabledUserReturns401() throws Exception {
        User user = givenUser(Role.MANAGER);
        String token = jwtService.generateToken(user);
        user.setEnabled(false);
        expectUnauthorized(token);
    }

    @Test
    void userRemovedBetweenAuthenticationAndLookupReturns401() throws Exception {
        User user = givenUser(Role.EMPLOYEE);
        when(repository.findByEmail(user.getEmail())).thenReturn(Optional.of(user), Optional.empty());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + jwtService.generateToken(user)))
                .andExpect(status().isUnauthorized())
                .andExpect(content().json("{\"error\":\"Authentication failed\"}"));
    }

    @Test
    void loginRemainsPublic() throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json").content("{}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(repository);
    }

    private User givenUser(Role role) {
        User user = new User();
        user.setEmail("fictional@example.com");
        user.setPasswordHash("unused");
        user.setRole(role);
        when(repository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        return user;
    }

    private void expectUnauthorized(String token) throws Exception {
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized()).andExpect(content().string(""));
    }

    @Configuration
    @EnableWebSecurity
    @EnableWebMvc
    @Import({SecurityConfig.class, AuthController.class, AuthenticationService.class})
    static class TestConfig {
        @Bean
        UserRepository userRepository() { return mock(UserRepository.class); }

        @Bean
        CustomUserDetailsService userDetailsService(UserRepository repository) {
            return new CustomUserDetailsService(repository);
        }

        @Bean
        SecretKey testOnlyKey() { return Jwts.SIG.HS256.key().build(); }

        @Bean
        JwtService jwtService(SecretKey testOnlyKey) {
            return new JwtService(Base64.getEncoder().encodeToString(testOnlyKey.getEncoded()));
        }
    }
}
