<?php
// php/save_prompt.php - Modified to return the new prompt's ID

require_once 'config.php';

header('Content-Type: application/json');

// Get the POST data as JSON
$input = file_get_contents('php://input');
$data = json_decode($input, true);

// Validate JSON input
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400); // Bad Request
    echo json_encode(['error' => 'Invalid JSON input']);
    exit();
}

$required_fields = ['type', 'title', 'generated_prompt', 'prompt_data'];
foreach ($required_fields as $field) {
    if (!isset($data[$field])) {
        http_response_code(400); // Bad Request
        echo json_encode(['error' => 'Missing required field: ' . $field]);
        exit();
    }
}

$type = $data['type'];
$title = $data['title'];
$generated_prompt = $data['generated_prompt'];
$prompt_data_json = json_encode($data['prompt_data']); // Ensure prompt_data is stored as JSON string

// Prepare an insert statement
$sql = "INSERT INTO prompts (type, title, generated_prompt, prompt_data) VALUES (?, ?, ?, ?)";

if ($stmt = $conn->prepare($sql)) {
    // 'ssss' indicates four string parameters
    $stmt->bind_param("ssss", $type, $title, $generated_prompt, $prompt_data_json);

    if ($stmt->execute()) {
        $last_id = $conn->insert_id; // Get the ID of the newly inserted row
        echo json_encode([
            'message' => 'Prompt saved successfully!',
            'prompt' => [
                'id' => $last_id, // Include the ID in the response
                'type' => $type,
                'title' => $title,
                'generated_prompt' => $generated_prompt,
                'prompt_data' => $data['prompt_data'], // Return original array for frontend
                'created_at' => date('c') // Current time in ISO 8601 format
            ]
        ]);
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