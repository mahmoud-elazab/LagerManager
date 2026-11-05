package com.lagermanager.user;

import com.jayway.jsonpath.JsonPath;
import com.lagermanager.support.DisposableMySql;
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
class AccountManagementTests {
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        DisposableMySql.configure(registry, "lagermanager_accounts_test");
        String key = Base64.getEncoder().encodeToString(Jwts.SIG.HS256.key().build().getEncoded());
        registry.add("LAGERMANAGER_JWT_SECRET", () -> key);
    }
    @Autowired WebApplicationContext context;
    @Autowired FilterChainProxy filters;
    @Autowired UserRepository users;
    @Autowired PasswordEncoder passwords;
    MockMvc mvc;
    String admin;

    @BeforeEach void setup() throws Exception {
        mvc = webAppContextSetup(context).addFilters(filters).build();
        users.deleteAllInBatch();
        register("admin@accounts.example", "ADMIN");
        admin = login("admin@accounts.example");
    }

    @ParameterizedTest @EnumSource(Role.class)
    void adminCreatesAndListsAccountsWithAllRolesWithoutExposingCredentials(Role role) throws Exception {
        String email = "new+shift@sub-domain.accounts.example";
        String json = mvc.perform(post("/api/accounts").header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content(createBody(email, role, true)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.email").value(email))
                .andExpect(jsonPath("$.role").value(role.name())).andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.length()").value(4)).andReturn().getResponse().getContentAsString();
        User user = users.findByEmail(email).orElseThrow();
        assertTrue(passwords.matches(" original password ", user.getPasswordHash()));
        assertNotEquals(" original password ", user.getPasswordHash());
        assertEquals(user.getId().longValue(), ((Number) JsonPath.read(json, "$.id")).longValue());
        String token = login(email);
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value(role.name()));
        mvc.perform(get("/api/accounts").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].length()").value(4)).andExpect(jsonPath("$[1].length()").value(4))
                .andExpect(jsonPath("$[*].passwordHash").isEmpty()).andExpect(jsonPath("$[*].password").isEmpty());
    }

    @Test void roleAndEnabledUpdatesPreserveIdentityAndPasswordAndEnforceCurrentState() throws Exception {
        register("subject@accounts.example", "EMPLOYEE");
        User original = users.findByEmail("subject@accounts.example").orElseThrow();
        String token = login(original.getEmail());
        String path = "/api/accounts/" + original.getId();
        mvc.perform(put(path).header("Authorization", "Bearer " + admin).contentType("application/json")
                        .content("{\"role\":\"ADMIN\",\"enabled\":true,\"email\":\"other@example.com\",\"password\":\"replacement\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.email").value(original.getEmail()));
        // Existing JWT permissions come from the updated database role.
        mvc.perform(get("/api/accounts").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        update(path, "MANAGER", false);
        User disabled = users.findById(original.getId()).orElseThrow();
        assertEquals(original.getEmail(), disabled.getEmail());
        assertEquals(original.getPasswordHash(), disabled.getPasswordHash());
        assertFalse(disabled.isEnabled());
        assertEquals(Role.MANAGER, disabled.getRole());
        mvc.perform(post("/api/auth/login").contentType("application/json").content(loginBody(original.getEmail())))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)).andExpect(status().isUnauthorized());
        update(path, "MANAGER", true);
        token = login(original.getEmail());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("MANAGER"));
        mvc.perform(get("/api/accounts").header("Authorization", "Bearer " + token)).andExpect(status().isForbidden());
    }

    @Test void adminCanCreateDisabledAccountAndDuplicateCannotOverwriteIt() throws Exception {
        mvc.perform(post("/api/accounts").header("Authorization", "Bearer " + admin).contentType("application/json")
                        .content(createBody("disabled@accounts.example", Role.EMPLOYEE, false)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.enabled").value(false));
        User original = users.findByEmail("disabled@accounts.example").orElseThrow();
        mvc.perform(post("/api/auth/login").contentType("application/json").content(loginBody(original.getEmail())))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/accounts").header("Authorization", "Bearer " + admin).contentType("application/json")
                        .content(createBody("DISABLED@accounts.example", Role.ADMIN, true)))
                .andExpect(status().isConflict());
        User retained = users.findById(original.getId()).orElseThrow();
        assertEquals(original.getPasswordHash(), retained.getPasswordHash());
        assertEquals(Role.EMPLOYEE, retained.getRole());
        assertFalse(retained.isEnabled());
        // Public duplicate registration also cannot re-enable or replace this account.
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"email\":\"disabled@accounts.example\",\"password\":\"replacement\",\"role\":\"ADMIN\"}"))
                .andExpect(status().isConflict());
        assertFalse(users.findById(original.getId()).orElseThrow().isEnabled());
    }

    @ParameterizedTest @EnumSource(value = Role.class, names = {"MANAGER", "EMPLOYEE"})
    void nonAdminsCannotListCreateOrUpdateAccounts(Role role) throws Exception {
        register("viewer@accounts.example", role.name());
        String token = login("viewer@accounts.example");
        User target = users.findByEmail("admin@accounts.example").orElseThrow();
        long count = users.count();
        mvc.perform(get("/api/accounts").header("Authorization", "Bearer " + token)).andExpect(status().isForbidden());
        mvc.perform(post("/api/accounts").header("Authorization", "Bearer " + token).contentType("application/json")
                .content(createBody("rejected@accounts.example", Role.ADMIN, true))).andExpect(status().isForbidden());
        mvc.perform(put("/api/accounts/" + target.getId()).header("Authorization", "Bearer " + token).contentType("application/json")
                .content("{\"role\":\"EMPLOYEE\",\"enabled\":false}")).andExpect(status().isForbidden());
        assertEquals(count, users.count());
        User retained = users.findById(target.getId()).orElseThrow();
        assertEquals(Role.ADMIN, retained.getRole());
        assertTrue(retained.isEnabled());
    }

    @Test void anonymousManagementRequiresAuthenticationAndNoDeleteEndpointExists() throws Exception {
        mvc.perform(get("/api/accounts")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/accounts").contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/accounts/1").contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/accounts/1").header("Authorization", "Bearer " + admin)).andExpect(status().isMethodNotAllowed());
    }

    @ParameterizedTest @ValueSource(strings = {"{}", "null", "{", "[]",
            "{\"role\":\"OWNER\",\"enabled\":true}", "{\"role\":\"ADMIN\",\"enabled\":\"false\"}",
            "{\"role\":\"ADMIN\"}", "{\"enabled\":true}"})
    void invalidUpdatesDoNotModifyAccount(String body) throws Exception {
        User original = users.findByEmail("admin@accounts.example").orElseThrow();
        mvc.perform(put("/api/accounts/" + original.getId()).header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content(body)).andExpect(status().isBadRequest());
        User retained = users.findById(original.getId()).orElseThrow();
        assertEquals(Role.ADMIN, retained.getRole()); assertTrue(retained.isEnabled());
        assertEquals(original.getPasswordHash(), retained.getPasswordHash());
    }

    @Test void invalidCreationAndMissingUpdateAreRejected() throws Exception {
        long count = users.count();
        for (String body : new String[] {"{}", "null", "[]", "{",
                createBody("invalid", Role.ADMIN, true), createBody("long@accounts.example", Role.ADMIN, true).replace(" original password ", "é".repeat(37)),
                createBody("blank@accounts.example", Role.ADMIN, true).replace(" original password ", " "),
                createBody("x".repeat(250) + "@accounts.example", Role.ADMIN, true)}) {
            mvc.perform(post("/api/accounts").header("Authorization", "Bearer " + admin).contentType("application/json").content(body))
                    .andExpect(status().isBadRequest());
        }
        assertEquals(count, users.count());
        mvc.perform(put("/api/accounts/9223372036854775807").header("Authorization", "Bearer " + admin)
                .contentType("application/json").content("{\"role\":\"EMPLOYEE\",\"enabled\":true}"))
                .andExpect(status().isNotFound());
    }

    @Test void rejectsEmailIncompatibleWithSignInWithoutStoringAccount() throws Exception {
        long count = users.count();
        String email = "worker@bad_host.example";
        mvc.perform(post("/api/accounts").header("Authorization", "Bearer " + admin)
                        .contentType("application/json").content(createBody(email, Role.EMPLOYEE, true)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value(AccountCreationService.INVALID_INPUT));
        assertEquals(count, users.count());
        assertTrue(users.findByEmail(email).isEmpty());
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"email\":\"worker@bad_host.example\",\"password\":\"password\",\"role\":\"EMPLOYEE\"}"))
                .andExpect(status().isBadRequest());
        assertEquals(count, users.count());
        assertTrue(users.findByEmail(email).isEmpty());
    }

    private void update(String path, String role, boolean enabled) throws Exception {
        mvc.perform(put(path).header("Authorization", "Bearer " + admin).contentType("application/json")
                        .content("{\"role\":\"" + role + "\",\"enabled\":" + enabled + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value(role)).andExpect(jsonPath("$.enabled").value(enabled));
    }
    private String createBody(String email, Role role, boolean enabled) {
        return "{\"email\":\"" + email + "\",\"password\":\" original password \",\"role\":\"" + role.name() + "\",\"enabled\":" + enabled + "}";
    }
    private String loginBody(String email) { return "{\"email\":\"" + email + "\",\"password\":\" original password \"}"; }
    private void register(String email, String role) throws Exception {
        mvc.perform(post("/api/auth/register").contentType("application/json")
                        .content("{\"email\":\"" + email + "\",\"password\":\" original password \",\"role\":\"" + role + "\"}"))
                .andExpect(status().isCreated());
    }
    private String login(String email) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json").content(loginBody(email)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.token");
    }
}
