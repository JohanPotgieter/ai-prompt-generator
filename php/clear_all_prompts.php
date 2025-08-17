<?php
// php/clear_all_prompts.php

require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');
// Avoid caching the response
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    echo json_encode(['error' => 'Only POST requests are allowed for this endpoint.']);
    exit();
}

// Optional: if you want to add a simple admin key later, uncomment:
// $adminKey = $_SERVER['HTTP_X_ADMIN_KEY'] ?? '';
// if ($adminKey !== ADMIN_API_KEY) {
//     http_response_code(401);
//     echo json_encode(['error' => 'Unauthorised']);
//     exit();
// }

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT); // Throw exceptions
$deleted = 0;

try {
    // Ensure correct charset
    if (method_exists($conn, 'set_charset')) {
        $conn->set_charset('utf8mb4');
    }

    // Wrap in transaction
    $conn->begin_transaction();

    // If you know there are NO foreign keys referencing `prompts`,
    // TRUNCATE is faster. Otherwise keep DELETE for safety.
    // $conn->query("TRUNCATE TABLE prompts");

    $conn->query("DELETE FROM prompts");
    $deleted = $conn->affected_rows;

    $conn->commit();

    echo json_encode([
        'message' => 'All prompts cleared successfully!',
        'deleted' => $deleted
    ]);

} catch (mysqli_sql_exception $e) {
    // Roll back any partial work
    if ($conn->errno) {
        $conn->rollback();
    }
    http_response_code(500);
    echo json_encode(['error' => 'Error clearing prompts', 'detail' => $e->getMessage()]);
} finally {
    if ($conn) {
        $conn->close();
    }
}
