<?php
// php/delete_prompt.php

require_once 'config.php';

header('Content-Type: application/json');

// Get the POST data (expecting { "id": 123 })
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (json_last_error() !== JSON_ERROR_NONE || !isset($data['id'])) {
    http_response_code(400); // Bad Request
    echo json_encode(['error' => 'Invalid input or missing prompt ID']);
    exit();
}

$id = (int)$data['id']; // Cast to integer to ensure safety

// Prepare delete statement
$sql = "DELETE FROM prompts WHERE id = ?";

if ($stmt = $conn->prepare($sql)) {
    $stmt->bind_param("i", $id); // 'i' for integer

    if ($stmt->execute()) {
        if ($stmt->affected_rows > 0) {
            echo json_encode(['message' => 'Prompt deleted successfully!', 'id' => $id]);
        } else {
            http_response_code(404); // Not Found (if ID didn't match any row)
            echo json_encode(['error' => 'Prompt not found or already deleted.']);
        }
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to execute statement: ' . $stmt->error]);
    }
    $stmt->close();
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to prepare statement: ' . $conn->error]);
}

$conn->close();
?>