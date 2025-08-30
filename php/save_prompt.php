<?php
// php/save_prompt.php
ob_start(); // buffer anything accidental

const DEBUG = false;
require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $payload): void {
    // Drop any accidental output before sending JSON
    if (ob_get_level()) { ob_clean(); }
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit();
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Only POST requests are allowed for this endpoint.']);
}

$maxBytes = 1024 * 1024;
$contentLength = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
if ($contentLength > $maxBytes) {
    respond(413, ['ok' => false, 'error' => 'Payload too large. Limit is 1 MB.']);
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    respond(400, ['ok' => false, 'error' => 'Empty request body']);
}

try {
    $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    respond(400, ['ok' => false, 'error' => 'Invalid JSON input', 'details' => DEBUG ? $e->getMessage() : null]);
}

$required = ['type', 'title', 'generated_prompt', 'prompt_data'];
foreach ($required as $field) {
    if (!array_key_exists($field, $data)) {
        respond(400, ['ok' => false, 'error' => "Missing required field: {$field}"]);
    }
}

$type             = trim((string)$data['type']);
$title            = trim((string)$data['title']);
$generated_prompt = (string)$data['generated_prompt'];
$prompt_data_arr  = $data['prompt_data'];

$allowedTypes = ['tcrei', 'design', 'agent'];
if ($type === '' || !in_array($type, $allowedTypes, true)) {
    respond(400, ['ok' => false, 'error' => 'Invalid "type". Allowed: ' . implode(', ', $allowedTypes)]);
}
if ($title === '') {
    respond(400, ['ok' => false, 'error' => 'Title cannot be empty']);
}
if (mb_strlen($title, 'UTF-8') > 255) {
    $title = mb_substr($title, 0, 255, 'UTF-8');
}

$prompt_data_json = json_encode($prompt_data_arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($prompt_data_json === false) {
    respond(400, ['ok' => false, 'error' => 'Invalid prompt_data (not JSON encodable)']);
}

if (!isset($conn) || !($conn instanceof mysqli)) {
    $extra = isset($GLOBALS['DB_CONNECT_ERROR']) && $GLOBALS['DB_CONNECT_ERROR']
        ? ' (' . $GLOBALS['DB_CONNECT_ERROR'] . ')'
        : '';
    respond(500, ['ok' => false, 'error' => 'Database connection not initialized' . $extra]);
}

if (!isset($conn) || !($conn instanceof mysqli)) {
    respond(500, ['ok' => false, 'error' => 'Database connection not initialized']);
}

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $conn->set_charset('utf8mb4');

    $sql  = "INSERT INTO prompts (type, title, generated_prompt, prompt_data) VALUES (?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ssss', $type, $title, $generated_prompt, $prompt_data_json);
    $stmt->execute();

    $last_id = $conn->insert_id;

    $created_at = null;
    try {
        $q = $conn->prepare("SELECT created_at FROM prompts WHERE id = ? LIMIT 1");
        $q->bind_param('i', $last_id);
        $q->execute();
        $q->bind_result($created_at);
        $q->fetch();
        $q->close();
    } catch (mysqli_sql_exception $e) {}

    respond(200, [
        'ok'     => true,
        'message'=> 'Prompt saved successfully!',
        'prompt' => [
            'id'               => $last_id,
            'type'             => $type,
            'title'            => $title,
            'generated_prompt' => $generated_prompt,
            'prompt_data'      => $prompt_data_arr,
            'created_at'       => $created_at ?: date('c'),
        ],
    ]);

} catch (mysqli_sql_exception $e) {
    error_log('[SAVE_PROMPT_ERROR] ' . $e->getMessage());
    respond(500, ['ok' => false, 'error' => DEBUG ? ('DB error: ' . $e->getMessage()) : 'Failed to save prompt']);
} finally {
    if (isset($stmt) && $stmt instanceof mysqli_stmt) { $stmt->close(); }
    if (isset($conn) && $conn instanceof mysqli) { $conn->close(); }
}
