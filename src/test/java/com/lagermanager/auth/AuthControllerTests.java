package com.lagermanager.auth;

import com.jayway.jsonpath.JsonPath;
import com.lagermanager.security.CustomUserDetailsService;
import com.lagermanager.security.JwtService;
import com.lagermanager.security.SecurityConfig;
import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import com.lagermanager.user.UserRepository;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Base64;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AuthControllerTests {

    private MockMvc mockMvc;
    private UserRepository userRepository;
    private PasswordEncoder passwordEncoder;
    private JwtService jwtService;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        SecurityConfig config = new SecurityConfig();
        passwordEncoder = config.passwordEncoder();
        // Random, ephemeral test-only key; no production environment secret needed.
        jwtService = new JwtService(Base64.getEncoder().encodeToString(
                Jwts.SIG.HS256.key().build().getEncoded()));
        AuthenticationService service = new AuthenticationService(config.authenticationManager(
                config.authenticationProvider(new CustomUserDetailsService(userRepository), passwordEncoder)),
                userRepository, jwtService);
        mockMvc = MockMvcBuilders.standaloneSetup(new AuthController(service)).build();
    }

    @Test
    void successfulLoginReturnsVerifiedJwtAndBearerType() throws Exception {
        givenUser(true);
        String response = mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"test@example.com\",\"password\":\"test-password\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isString())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        String token = JsonPath.read(response, "$.token");
        assertTrue(jwtService.isTokenValid(token));
        assertEquals("test@example.com", jwtService.extractSubject(token));
    }

    @Test
    void incorrectPasswordReturnsGenericUnauthorized() throws Exception {
        givenUser(true);
        expectUnauthorized("{\"email\":\"test@example.com\",\"password\":\"incorrect-password\"}");
    }

    @Test
    void unknownEmailReturnsGenericUnauthorized() throws Exception {
        expectUnauthorized("{\"email\":\"unknown@example.com\",\"password\":\"test-password\"}");
    }

    @Test
    void disabledAccountReturnsGenericUnauthorized() throws Exception {
        givenUser(false);
        expectUnauthorized("{\"email\":\"test@example.com\",\"password\":\"test-password\"}");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{}", "null", "", "{", "[]",
            "{\"email\":\"test@example.com\"}",
            "{\"password\":\"test-password\"}",
            "{\"email\":null,\"password\":\"test-password\"}",
            "{\"email\":\"test@example.com\",\"password\":null}",
            "{\"email\":\"\",\"password\":\"test-password\"}",
            "{\"email\":\"test@example.com\",\"password\":\"\"}",
            "{\"email\":\"  \",\"password\":\"test-password\"}",
            "{\"email\":\"test@example.com\",\"password\":\"  \"}"
    })
    void invalidRequestsReturnBadRequestWithoutAuthentication(String body) throws Exception {
        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(content().json("{\"error\":\"Invalid login request\"}"));
        verifyNoInteractions(userRepository);
    }

    private void expectUnauthorized(String body) throws Exception {
        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized())
                .andExpect(content().json("{\"error\":\"Authentication failed\"}"))
                .andExpect(jsonPath("$.token").doesNotExist());
    }

    private void givenUser(boolean enabled) {
        User user = new User(1L, "test@example.com", passwordEncoder.encode("test-password"),
                Role.EMPLOYEE, enabled);
        when(userRepository.findByEmail("test@example.com")).thenReturn(Optional.of(user));
    }
}
