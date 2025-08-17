<?php
// php/config.php

define('DB_SERVER', '127.0.0.1'); // Or 127.0.0.1, or the IP of your MySQL server if it's separate
define('DB_USERNAME', 'prompt_u_98743'); // Your MySQL username
define('DB_PASSWORD', 'MRzRXA86s%hg992RZ%33'); // Your MySQL password
define('DB_NAME', 'genai_prompts');

// Attempt to connect to MySQL database
$conn = new mysqli(DB_SERVER, DB_USERNAME, DB_PASSWORD, DB_NAME);

// Check connection
if ($conn->connect_error) {
    http_response_code(500); // Internal Server Error
    die(json_encode(['error' => 'Database connection failed: ' . $conn->connect_error]));
}

// Set charset to utf8mb4 for full UTF-8 support (especially for emojis in prompts)
$conn->set_charset("utf8mb4");
?>