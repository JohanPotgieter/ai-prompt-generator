<?php
// php/clear_all_prompts.php - Renamed for clarity

require_once 'config.php';

header('Content-Type: application/json');

// It's good practice to expect a POST request even for DELETE operations
// to avoid accidental clearing via GET requests.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    echo json_encode(['error' => 'Only POST requests are allowed for this endpoint.']);
    exit();
}

$sql = "DELETE FROM prompts";

if ($conn->query($sql) === TRUE) {
    echo json_encode(['message' => 'All prompts cleared successfully!']);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Error clearing prompts: ' . $conn->error]);
}

$conn->close();
?>