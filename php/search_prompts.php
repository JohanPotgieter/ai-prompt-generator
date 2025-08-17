<?php
// php/search_prompts.php - FINAL PRODUCTION-READY VERSION
// Uses direct mysqli::query for data fetch, with proper escaping for security.

ini_set('display_errors', 0); // IMPORTANT: Turn off display_errors in production
ini_set('display_startup_errors', 0);
error_reporting(E_ALL); // Log all errors

require_once 'config.php';

header('Content-Type: application/json');

// --- 1. Parameter Parsing and Building WHERE Clause ---
$type_filter = isset($_GET['type']) ? $_GET['type'] : 'All';
$keyword = isset($_GET['keyword']) ? trim($_GET['keyword']) : '';
$page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 10;

// Sanitize and validate limit
if ($limit <= 0 || $limit > 50) {
    $limit = 10;
}
$offset = ($page - 1) * $limit;
if ($offset < 0) {
    $offset = 0;
}

// Variables for building the WHERE clause for the prepared statement (for COUNT)
$sql_where_clauses_prepared = [];
$params_for_count_stmt = [];
$param_types_for_count_stmt = '';

// Variables for building the WHERE clause for the direct SELECT query (with manual escaping)
$direct_where_clause_parts = [];

// --- Build WHERE clauses and parameters for both COUNT (prepared) and SELECT (direct) ---
if ($type_filter !== 'All') {
    $sql_where_clauses_prepared[] = "type = ?";
    $params_for_count_stmt[] = $type_filter;
    $param_types_for_count_stmt .= 's';

    // Manually escape for the direct query string
    $escaped_type_filter = $conn->real_escape_string($type_filter);
    $direct_where_clause_parts[] = "type = '$escaped_type_filter'";
}

if (!empty($keyword)) {
    $keyword_param = '%' . $keyword . '%';
    $sql_where_clauses_prepared[] = "(title LIKE ? OR generated_prompt LIKE ?)";
    $params_for_count_stmt[] = $keyword_param;
    $params_for_count_stmt[] = $keyword_param;
    $param_types_for_count_stmt .= 'ss';

    // Manually escape for the direct query string
    $escaped_keyword_param = $conn->real_escape_string($keyword_param);
    $direct_where_clause_parts[] = "(title LIKE '$escaped_keyword_param' OR generated_prompt LIKE '$escaped_keyword_param')";
}

// Build the final WHERE clause strings
$where_clause_for_prepared = '';
if (!empty($sql_where_clauses_prepared)) {
    $where_clause_for_prepared = " WHERE " . implode(" AND ", $sql_where_clauses_prepared);
}

$where_clause_for_direct = '';
if (!empty($direct_where_clause_parts)) {
    $where_clause_for_direct = " WHERE " . implode(" AND ", $direct_where_clause_parts);
}

// --- 2. COUNT Query (STILL uses prepared statement, as it worked reliably for counting) ---
$count_sql = "SELECT COUNT(*) AS total FROM prompts" . $where_clause_for_prepared;
$stmt_count = $conn->prepare($count_sql);

if ($stmt_count === false) {
    error_log('ERROR (search_prompts): COUNT statement prepare failed: ' . $conn->error);
    http_response_code(500);
    echo json_encode(['error' => 'Failed to prepare count statement.']);
    exit();
}

if (!empty($params_for_count_stmt)) {
    // Using splat operator for PHP 8.1+
    if (! $stmt_count->bind_param($param_types_for_count_stmt, ...$params_for_count_stmt)) {
        error_log('ERROR (search_prompts): COUNT statement bind_param failed: ' . $stmt_count->error);
        http_response_code(500);
        echo json_encode(['error' => 'Failed to bind parameters for count.']);
        exit();
    }
}
$stmt_count->execute();
$count_result = $stmt_count->get_result();
$total_prompts = $count_result->fetch_assoc()['total'];
$stmt_count->close();

// Calculate pagination details
$total_pages = ceil($total_prompts / $limit);
if ($total_pages == 0 && $total_prompts > 0) { $total_pages = 1; }
if ($page > $total_pages && $total_pages > 0) { $page = $total_pages; $offset = ($page - 1) * $limit; }
elseif ($page < 1) { $page = 1; $offset = 0; }


// --- 3. Main Data SELECT Query (NOW uses direct query with manual escaping and full columns) ---
// Note: $limit and $offset are already sanitized integers, so they can be directly inserted.
$data_sql = "SELECT id, type, title, generated_prompt, prompt_data, created_at FROM prompts"
          . $where_clause_for_direct // Use the manually escaped WHERE clause
          . " ORDER BY created_at DESC LIMIT $limit OFFSET $offset";

$result = $conn->query($data_sql); // Direct query!

if ($result === false) {
    error_log('ERROR (search_prompts): Direct data query failed: ' . $conn->error);
    http_response_code(500);
    echo json_encode(['error' => 'Failed to execute direct data query: ' . $conn->error]);
    exit();
}

$prompts = [];
while ($row = $result->fetch_assoc()) {
    // Attempt to decode JSON for prompt_data
    $decoded_prompt_data = json_decode($row['prompt_data'], true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        error_log('WARNING (search_prompts): JSON decode error for prompt_data (ID: ' . $row['id'] . '): ' . json_last_error_msg());
        $row['prompt_data'] = []; // Set to empty array on error
    } else {
        $row['prompt_data'] = $decoded_prompt_data;
    }
    $prompts[] = $row;
}
// For direct query results, resource is automatically freed when script ends or object is unset.
// $result->free(); // Optional, but good practice for large results


// --- 4. Return JSON Response ---
echo json_encode([
    'total_prompts' => $total_prompts,
    'per_page' => $limit,
    'current_page' => $page,
    'total_pages' => $total_pages,
    'prompts' => $prompts
]);

$conn->close();
?>