<?php
// php/config.php

$envPath = __DIR__ . '/../.env'; // adjust if .env is in project root
if (is_readable($envPath)) {
    $pairs = parse_ini_file($envPath, false, INI_SCANNER_TYPED);
    if (is_array($pairs)) {
        foreach ($pairs as $k => $v) {
            if (getenv($k) === false) {
                putenv($k . '=' . $v);
            }
        }
    }
}

// Expect values to come from .env or system environment
$DB_SERVER   = getenv('DB_SERVER')   ?: '127.0.0.1';
$DB_USERNAME = getenv('DB_USERNAME') ?: '';
$DB_PASSWORD = getenv('DB_PASSWORD') ?: '';
$DB_NAME     = getenv('DB_NAME')     ?: '';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $conn = new mysqli($DB_SERVER, $DB_USERNAME, $DB_PASSWORD, $DB_NAME);
    $conn->set_charset('utf8mb4');
} catch (mysqli_sql_exception $e) {
    error_log('[DB CONNECT ERROR] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit();
}