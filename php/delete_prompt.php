<?php
// php/delete_prompt.php

require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// Only allow POST to avoid accidental deletes
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    echo json_encode(['error' => 'Only POST requests are allowed for this endpoint.']);
    exit();
}

// Optional admin key (uncomment to enable)
// $adminKey = $_SERVER['HTTP_X_ADMIN_KEY'] ?? '';
// if ($adminKey !== getenv('ADMIN_API_KEY')) {
//     http_response_code(401);
//     echo json_encode(['error' => 'Unauthorised']);
//     exit();
// }

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (json_last_error() !== JSON_ERROR_NONE || !isset($data['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON or missing "id"']);
    exit();
}

// Coerce and validate id
$id = filter_var($data['id'], FILTER_VALIDATE_INT);
if ($id === false || $id <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid "id" (must be a positive integer)']);
    exit();
}

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    // Ensure correct charset
    if (method_exists($conn, 'set_charset')) {
        $conn->set_charset('utf8mb4');
    }

    // Prepared delete with LIMIT 1 as an extra guard
    $sql = "DELETE FROM prompts WHERE id = ? LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('i', $id);
    $stmt->execute();

    if ($stmt->affected_rows > 0) {
        echo json_encode([
            'message' => 'Prompt deleted successfully!',
            'id' => $id
        ]);
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'Prompt not found or already deleted.']);
    }

    $stmt->close();

} catch (mysqli_sql_exception $e) {
    error_log('[DELETE PROMPT ERROR] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Failed to delete prompt']);
} finally {
    if ($conn) {
        $conn->close();
    }
}

?>