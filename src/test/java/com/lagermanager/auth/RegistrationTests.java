package com.lagermanager.auth;

import com.jayway.jsonpath.JsonPath;
import com.lagermanager.support.DisposableMySql;
import com.lagermanager.user.*;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.context.WebApplicationContext;

import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup;

@SpringBootTest
@org.springframework.test.context.ActiveProfiles("test")
@EnabledIf("com.lagermanager.support.DisposableMySql#isAvailable")
class RegistrationTests {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        DisposableMySql.configure(registry, "lagermanager_registration_test");
        String key = Base64.getEncoder().encodeToString(Jwts.SIG.HS256.key().build().getEncoded());
        registry.add("LAGERMANAGER_JWT_SECRET", () -> key);
    }

    @Autowired WebApplicationContext context;
    @Autowired FilterChainProxy filters;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder passwords;
    MockMvc mvc;

    @BeforeEach void setup() {
        mvc = webAppContextSetup(context).addFilters(filters).build();
    }

    @ParameterizedTest @EnumSource(Role.class)
    void publicRegistrationPersistsHashAndCanLoginWithSelectedRole(Role role) throws Exception {
        String email = role.name().toLowerCase() + "@registration.example";
        register(email, " original password ", role.name(), 201);
        User original = users.findByEmail(email).orElseThrow();
        String hash = original.getPasswordHash();
        assertNotEquals(" original password ", hash);
        assertTrue(passwords.matches(" original password ", hash));
        assertTrue(original.isEnabled());
        assertEquals(role, original.getRole());
        // Attempt to replace credentials and role; the stored account must remain intact.
        register(email, "replacement-password", "ADMIN", 409);
        register(email.toUpperCase(), "replacement-password", "EMPLOYEE", 409);
        User retained = users.findByEmail(email).orElseThrow();
        assertEquals(original.getId(), retained.getId());
        assertEquals(hash, retained.getPasswordHash());
        assertEquals(role, retained.getRole());
        assertTrue(retained.isEnabled());
        String response = mvc.perform(post("/api/auth/login").contentType("application/json")
                        .content("{\"email\":\"" + email + "\",\"password\":\" original password \"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String token = JsonPath.read(response, "$.token");
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value(role.name()))
                .andExpect(jsonPath("$.email").value(email));
        mvc.perform(post("/api/auth/login").contentType("application/json")
                        .content("{\"email\":\"" + email + "\",\"password\":\"replacement-password\"}"))
                .andExpect(status().isUnauthorized());
    }

    @ParameterizedTest @ValueSource(strings = {"{}", "null", "{", "[]",
            "{\"email\":\"bad\",\"password\":\"password\",\"role\":\"ADMIN\"}",
            "{\"email\":\"x@example.com\",\"password\":\" \",\"role\":\"ADMIN\"}",
            "{\"email\":\"x@example.com\",\"password\":\"password\",\"role\":\"OWNER\"}",
            "{\"email\":\"x@example.com\",\"password\":\"password\",\"role\":null}"})
    void invalidInputDoesNotCreateUsers(String body) throws Exception {
        long count = users.count();
        mvc.perform(post("/api/auth/register").contentType("application/json").content(body))
                .andExpect(status().isBadRequest());
        assertEquals(count, users.count());
    }

    @Test void rejectsOversizedEmailAndUtf8Password() throws Exception {
        long count = users.count();
        register("x@example.com", "é".repeat(37), "ADMIN", 400);
        register("x".repeat(250) + "@example.com", "password", "ADMIN", 400);
        assertEquals(count, users.count());
    }

    @Test void concurrentDuplicatesInsertOnlyOneAccount() throws Exception {
        long count = users.count();
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var start = new java.util.concurrent.CountDownLatch(1);
            java.util.concurrent.Callable<Integer> attempt = () -> {
                start.await();
                return mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"email\":\"race@registration.example\",\"password\":\"password\",\"role\":\"MANAGER\"}"))
                        .andReturn().getResponse().getStatus();
            };
            var first = executor.submit(attempt);
            var second = executor.submit(attempt);
            start.countDown();
            assertEquals(java.util.Set.of(201, 409), java.util.Set.of(first.get(), second.get()));
        }
        assertEquals(count + 1, users.count());
    }

    private void register(String email, String password, String role, int status) throws Exception {
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\",\"role\":\"" + role + "\"}"))
                .andExpect(status().is(status)).andExpect(jsonPath("$.passwordHash").doesNotExist());
    }
}
