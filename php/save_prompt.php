<?php
// php/save_prompt.php

require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// Enforce POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Only POST requests are allowed for this endpoint.']);
    exit();
}

// Optional: enforce JSON Content-Type (uncomment to be strict)
// $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
// if (stripos($contentType, 'application/json') === false) {
//     http_response_code(415);
//     echo json_encode(['error' => 'Content-Type must be application/json']);
//     exit();
// }

// Optional: size limit (1 MB)
$maxBytes = 1024 * 1024; // 1 MB
$contentLength = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
if ($contentLength > $maxBytes) {
    http_response_code(413);
    echo json_encode(['error' => 'Payload too large. Limit is 1 MB.']);
    exit();
}

// Read and decode JSON
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

// Validate JSON
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON input']);
    exit();
}

// Required fields
$required_fields = ['type', 'title', 'generated_prompt', 'prompt_data'];
foreach ($required_fields as $field) {
    if (!array_key_exists($field, $data)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing required field: ' . $field]);
        exit();
    }
}

// Normalise & basic validation
$type            = trim((string)$data['type']);
$title           = trim((string)$data['title']);
$generated_prompt= (string)$data['generated_prompt'];
$prompt_data_arr = $data['prompt_data'];

// Constrain allowed types (extend as needed)
$allowedTypes = ['tcrei', 'design'];
if ($type === '' || !in_array($type, $allowedTypes, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid "type". Allowed: ' . implode(', ', $allowedTypes)]);
    exit();
}

if ($title === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Title cannot be empty']);
    exit();
}

// Clamp title length to match a sensible DB column size
if (mb_strlen($title, 'UTF-8') > 255) {
    $title = mb_substr($title, 0, 255, 'UTF-8');
}

// Ensure prompt_data is JSON encodable
$prompt_data_json = json_encode(
    $prompt_data_arr,
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
);
if ($prompt_data_json === false) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid prompt_data (not JSON encodable)']);
    exit();
}

// Use mysqli exceptions for cleaner error handling
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    if (method_exists($conn, 'set_charset')) {
        $conn->set_charset('utf8mb4');
    }

    // Insert
    $sql = "INSERT INTO prompts (type, title, generated_prompt, prompt_data) VALUES (?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ssss', $type, $title, $generated_prompt, $prompt_data_json);
    $stmt->execute();

    $last_id = $conn->insert_id;

    // Try to fetch created_at if your table has it
    $created_at = null;
    try {
        $q = $conn->prepare("SELECT created_at FROM prompts WHERE id = ? LIMIT 1");
        $q->bind_param('i', $last_id);
        $q->execute();
        $q->bind_result($created_at);
        $q->fetch();
        $q->close();
    } catch (mysqli_sql_exception $e) {
        // Column might not exist; ignore
    }

    echo json_encode([
        'message' => 'Prompt saved successfully!',
        'prompt'  => [
            'id'               => $last_id,
            'type'             => $type,
            'title'            => $title,
            'generated_prompt' => $generated_prompt,
            'prompt_data'      => $data['prompt_data'], // return original array
            'created_at'       => $created_at ?: date('c'),
        ]
    ]);

    $stmt->close();

} catch (mysqli_sql_exception $e) {
    error_log('[SAVE_PROMPT_ERROR] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save prompt']);
} finally {
    if ($conn) {
        $conn->close();
    }
}

?>