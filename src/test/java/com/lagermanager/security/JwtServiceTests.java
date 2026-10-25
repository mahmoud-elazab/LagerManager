package com.lagermanager.security;

import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.SignatureException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.crypto.SecretKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.*;

class JwtServiceTests {

    private SecretKey key;
    private JwtService jwtService;

    @BeforeEach
    void setUp() {
        key = Jwts.SIG.HS256.key().build();
        jwtService = new JwtService(Base64.getEncoder().encodeToString(key.getEncoded()));
    }

    @Test
    void generatesHs256TokenWithExpectedClaims() {
        Instant before = Instant.now().minusSeconds(1);
        String token = generateToken();
        var parsed = Jwts.parser().verifyWith(key).build().parseSignedClaims(token);
        Claims claims = parsed.getPayload();

        assertEquals("HS256", parsed.getHeader().getAlgorithm());
        assertEquals("test@example.com", jwtService.extractSubject(token));
        assertEquals("MANAGER", claims.get("role", String.class));
        assertNotNull(claims.getIssuedAt());
        assertFalse(claims.getIssuedAt().toInstant().isBefore(before));
        assertFalse(claims.getIssuedAt().toInstant().isAfter(Instant.now()));
        assertEquals(3_600_000L, claims.getExpiration().getTime() - claims.getIssuedAt().getTime());
        assertFalse(claims.containsKey("password"));
        assertFalse(claims.containsKey("passwordHash"));
    }

    @Test
    void verifiesValidToken() {
        assertTrue(jwtService.isTokenValid(generateToken()));
    }

    @Test
    void rejectsExpiredToken() {
        String token = Jwts.builder().subject("test@example.com")
                .issuedAt(Date.from(Instant.now().minusSeconds(7200)))
                .expiration(Date.from(Instant.now().minusSeconds(3600)))
                .signWith(key, Jwts.SIG.HS256).compact();

        assertFalse(jwtService.isTokenValid(token));
        assertThrows(ExpiredJwtException.class, () -> jwtService.extractSubject(token));
    }

    @Test
    void rejectsTamperedToken() {
        String token = generateToken();
        String[] parts = token.split("\\.");
        parts[1] = Base64.getUrlEncoder().withoutPadding().encodeToString(
                "{\"sub\":\"changed@example.com\",\"exp\":4102444800}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String tampered = String.join(".", parts);

        assertFalse(jwtService.isTokenValid(tampered));
        assertThrows(SignatureException.class, () -> jwtService.extractSubject(tampered));
    }

    @Test
    void rejectsIncorrectSigningKey() {
        SecretKey otherKey = Jwts.SIG.HS256.key().build();
        JwtService otherService = new JwtService(Base64.getEncoder().encodeToString(otherKey.getEncoded()));
        String token = generateToken();

        assertFalse(otherService.isTokenValid(token));
        assertThrows(SignatureException.class, () -> otherService.extractSubject(token));
    }

    @Test
    void rejectsMissingMalformedAndShortSecrets() {
        assertThrows(IllegalArgumentException.class, () -> new JwtService(null));
        assertThrows(IllegalArgumentException.class, () -> new JwtService(""));
        assertThrows(IllegalArgumentException.class, () -> new JwtService(" "));
        assertThrows(IllegalArgumentException.class, () -> new JwtService("invalid!"));
        assertThrows(IllegalArgumentException.class,
                () -> new JwtService(Base64.getEncoder().encodeToString(new byte[31])));
    }

    @Test
    void rejectsTokensWithoutExpiration() {
        String token = Jwts.builder().subject("test@example.com")
                .signWith(key, Jwts.SIG.HS256).compact();
        assertFalse(jwtService.isTokenValid(token));
    }

    @Test
    void rejectsMalformedAndMissingTokens() {
        assertFalse(jwtService.isTokenValid("not-a-jwt"));
        assertFalse(jwtService.isTokenValid(""));
        assertFalse(jwtService.isTokenValid(null));
    }

    private String generateToken() {
        User user = new User();
        user.setEmail("test@example.com");
        user.setRole(Role.MANAGER);
        return jwtService.generateToken(user);
    }
}
