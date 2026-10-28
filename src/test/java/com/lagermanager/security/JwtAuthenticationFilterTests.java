package com.lagermanager.security;

import com.lagermanager.auth.AuthController;
import com.lagermanager.auth.AuthenticationService;
import com.lagermanager.product.ProductController;
import com.lagermanager.product.ProductService;
import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import com.lagermanager.user.UserRepository;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import javax.crypto.SecretKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class JwtAuthenticationFilterTests {

    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    private UserRepository repository;
    private ProductService products;
    private JwtService jwtService;
    private SecretKey key;

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        FilterChainProxy chain = context.getBean(FilterChainProxy.class);
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(chain).build();
        repository = context.getBean(UserRepository.class);
        products = context.getBean(ProductService.class);
        jwtService = context.getBean(JwtService.class);
        key = context.getBean(SecretKey.class);
        when(products.getAllProducts()).thenReturn(List.of());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        context.close();
    }

    @Test
    void validTokenUsesCurrentAuthoritiesAndRunsOnce() throws Exception {
        User user = givenUser(true);
        String token = jwtService.generateToken(user);
        user.setRole(Role.MANAGER);
        when(products.getAllProducts()).thenAnswer(invocation -> {
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            assertEquals("test@example.com", authentication.getName());
            assertEquals(List.of("ROLE_MANAGER"), authentication.getAuthorities().stream()
                    .map(authority -> authority.getAuthority()).toList());
            assertNull(authentication.getCredentials());
            return List.of();
        });
        var result = mvc.perform(get("/api/products").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(content().json("[]")).andReturn();
        assertNull(result.getRequest().getSession(false));
        assertNull(SecurityContextHolder.getContext().getAuthentication());
        verify(repository, times(1)).findByEmail("test@example.com");
        long filterCount = context.getBean(FilterChainProxy.class).getFilterChains().stream()
                .flatMap(chain -> chain.getFilters().stream())
                .filter(JwtAuthenticationFilter.class::isInstance).count();
        assertEquals(1, filterCount);
        // A subsequent request must not inherit authentication from the previous request.
        mvc.perform(get("/api/products")).andExpect(status().isUnauthorized());
    }

    @Test
    void missingTokenReturnsUnauthorized() throws Exception {
        mvc.perform(get("/api/products")).andExpect(status().isUnauthorized());
        verifyNoInteractions(repository, products);
    }

    @Test
    void expiredTokenReturnsUnauthorized() throws Exception {
        String token = Jwts.builder().subject("test@example.com")
                .expiration(Date.from(Instant.now().minusSeconds(60)))
                .signWith(key, Jwts.SIG.HS256).compact();
        expectUnauthorized(token);
        verifyNoInteractions(repository);
    }

    @Test
    void tamperedTokenReturnsUnauthorized() throws Exception {
        String token = jwtService.generateToken(givenUser(true));
        String[] parts = token.split("\\.");
        parts[1] = Base64.getUrlEncoder().withoutPadding().encodeToString(
                "{\"sub\":\"changed@example.com\",\"exp\":4102444800}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        expectUnauthorized(String.join(".", parts));
        verify(repository, never()).findByEmail(anyString());
    }

    @Test
    void unknownUserReturnsUnauthorized() throws Exception {
        User user = new User();
        user.setEmail("unknown@example.com");
        user.setRole(Role.EMPLOYEE);
        expectUnauthorized(jwtService.generateToken(user));
    }

    @Test
    void disabledUserReturnsUnauthorized() throws Exception {
        User user = givenUser(true);
        String token = jwtService.generateToken(user);
        user.setEnabled(false);
        expectUnauthorized(token);
    }

    @ParameterizedTest
    @ValueSource(strings = {"locked", "expired", "credentialsExpired"})
    void rejectsOtherInvalidAccountStates(String state) throws Exception {
        User user = givenUser(true);
        var details = org.springframework.security.core.userdetails.User.withUsername(user.getEmail())
                .password("unused").authorities("ROLE_EMPLOYEE")
                .accountLocked(state.equals("locked"))
                .accountExpired(state.equals("expired"))
                .credentialsExpired(state.equals("credentialsExpired")).build();
        doReturn(details).when(context.getBean(CustomUserDetailsService.class))
                .loadUserByUsername(user.getEmail());
        expectUnauthorized(jwtService.generateToken(user));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Bearer ", "Bearer malformed", "Basic unsupported"})
    void invalidAuthorizationReturnsUnauthorized(String authorization) throws Exception {
        mvc.perform(get("/api/products").header("Authorization", authorization))
                .andExpect(status().isUnauthorized()).andExpect(content().string(""));
        verifyNoInteractions(repository, products);
    }

    @Test
    void loginIsPublicAndIgnoresInvalidBearerToken() throws Exception {
        givenUser(true);
        mvc.perform(post("/api/auth/login").contentType("application/json")
                        .header("Authorization", "Bearer invalid")
                        .content("{\"email\":\"test@example.com\",\"password\":\"test-password\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.token").isString())
                .andExpect(jsonPath("$.tokenType").value("Bearer"));
    }

    @Test
    void onlyPostLoginIsPublic() throws Exception {
        mvc.perform(get("/api/auth/login")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").contentType("application/json").content("{}"))
                .andExpect(status().isBadRequest());
    }

    private User givenUser(boolean enabled) {
        User user = new User(1L, "test@example.com",
                context.getBean(PasswordEncoder.class).encode("test-password"), Role.EMPLOYEE, enabled);
        when(repository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        return user;
    }

    private void expectUnauthorized(String token) throws Exception {
        mvc.perform(get("/api/products").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized()).andExpect(content().string(""));
        verifyNoInteractions(products);
    }

    @Configuration
    @EnableWebSecurity
    @EnableWebMvc
    @Import({SecurityConfig.class, ProductController.class, AuthController.class, AuthenticationService.class})
    static class TestConfig {
        @Bean
        UserRepository userRepository() {
            return mock(UserRepository.class);
        }

        @Bean
        ProductService productService() {
            return mock(ProductService.class);
        }

        @Bean
        CustomUserDetailsService userDetailsService(UserRepository repository) {
            return spy(new CustomUserDetailsService(repository));
        }

        @Bean
        SecretKey testOnlyKey() {
            return Jwts.SIG.HS256.key().build();
        }

        @Bean
        JwtService jwtService(SecretKey testOnlyKey) {
            return new JwtService(Base64.getEncoder().encodeToString(testOnlyKey.getEncoded()));
        }
    }
}
