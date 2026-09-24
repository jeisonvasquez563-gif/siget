<?php
// Conexión a PostgreSQL en db-server (VM2), por la red interna del proyecto.
// Las credenciales viven en config.php (fuera de git) — ver config.example.php.
require __DIR__ . '/config.php';

try {
    $pdo = new PDO("pgsql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME, DB_USER, DB_PASSWORD, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    die('Error de conexión a la base de datos: ' . htmlspecialchars($e->getMessage()));
}
