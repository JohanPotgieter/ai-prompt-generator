<?php
// php/config.php

// --- Tolerant .env loader (dotenv-style, not INI strict) ---
$GLOBALS['ENV_DEBUG'] = ['candidates' => [], 'loaded' => null, 'pairs' => [], 'errors' => []];

function load_dotenv_tolerant(string $path): void {
    $GLOBALS['ENV_DEBUG']['candidates'][] = ['path' => $path, 'readable' => is_readable($path)];
    if (!is_readable($path)) return;

    $lines = @file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) return;

    $pairs = [];
    foreach ($lines as $lineno => $line) {
        $orig = $line;
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === ';') continue;
        if (stripos($line, 'export ') === 0) $line = trim(substr($line, 7));

        // Find first '=' outside quotes
        $inS = false; $inD = false; $pos = -1;
        $len = strlen($line);
        for ($i = 0; $i < $len; $i++) {
            $ch = $line[$i];
            if ($ch === "'" && !$inD) { $inS = !$inS; continue; }
            if ($ch === '"' && !$inS) { $inD = !$inD; continue; }
            if ($ch === '=' && !$inS && !$inD) { $pos = $i; break; }
        }
        if ($pos === -1) {
            $GLOBALS['ENV_DEBUG']['errors'][] = "Line ".($lineno+1).": no '=' found (got: {$orig})";
            continue;
        }

        $key = trim(substr($line, 0, $pos));
        $val = trim(substr($line, $pos+1));

        // Strip inline comments only if NOT quoted
        if ($val !== '' && $val[0] !== "'" && $val[0] !== '"') {
            $hash = strpos($val, '#');
            if ($hash !== false) {
                $val = rtrim(substr($val, 0, $hash));
            }
        }

        // Remove surrounding quotes
        if ($val !== '' && ($val[0] === "'" || $val[0] === '"')) {
            $q = $val[0];
            if (substr($val, -1) === $q) {
                $val = substr($val, 1, -1);
            } else {
                // unbalanced quote; keep as-is but record
                $GLOBALS['ENV_DEBUG']['errors'][] = "Line ".($lineno+1).": unbalanced quote";
                $val = ltrim($val, $q);
            }
            if ($q === '"') { // basic escapes for double-quoted
                $val = strtr($val, ["\\n" => "\n", "\\r" => "\r", "\\t" => "\t", "\\\"" => "\"", "\\\\" => "\\"]);
            }
        }

        if ($key === '') {
            $GLOBALS['ENV_DEBUG']['errors'][] = "Line ".($lineno+1).": empty key";
            continue;
        }

        // Export to env (won't overwrite existing)
        if (getenv($key) === false) putenv($key . '=' . $val);
        $pairs[] = $key;
    }

    $GLOBALS['ENV_DEBUG']['loaded'] = $path;
    $GLOBALS['ENV_DEBUG']['pairs']  = $pairs;
}

// Look for .env in project root then php/
$envCandidates = [
    realpath(__DIR__ . '/../.env'),
    realpath(__DIR__ . '/.env'),
];
foreach ($envCandidates as $cand) {
    if ($cand) { load_dotenv_tolerant($cand); if ($GLOBALS['ENV_DEBUG']['loaded']) break; }
}

// Fetch vars
$DB_SERVER   = getenv('DB_SERVER')   ?: null;
$DB_USERNAME = getenv('DB_USERNAME') ?: null;
$DB_PASSWORD = getenv('DB_PASSWORD') ?: null;
$DB_NAME     = getenv('DB_NAME')     ?: null;
$DB_PORT     = getenv('DB_PORT')     ?: null;
$DB_SOCKET   = getenv('DB_SOCKET')   ?: null;
$DB_DEBUG    = (bool) (getenv('DB_DEBUG') ?: false);

// Connect (silent; caller decides HTTP)
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$conn = null;
$GLOBALS['DB_CONNECT_ERROR'] = null;

try {
    $host   = $DB_SERVER ?: 'localhost';
    $port   = ($DB_PORT !== null && $DB_PORT !== '') ? (int)$DB_PORT : null;
    $socket = ($DB_SOCKET !== null && $DB_SOCKET !== '') ? $DB_SOCKET : null;

    // If socket provided, let mysqli use it (port may be null)
    $conn = @new mysqli($host, $DB_USERNAME ?: '', $DB_PASSWORD ?: '', $DB_NAME ?: '', $port, $socket);
    if (method_exists($conn, 'set_charset')) $conn->set_charset('utf8mb4');
} catch (mysqli_sql_exception $e) {
    error_log('[DB CONNECT ERROR] ' . $e->getMessage());
    if ($DB_DEBUG) {
        $GLOBALS['DB_CONNECT_ERROR'] =
            'host=' . ($DB_SERVER ?: 'null') .
            '; user=' . ($DB_USERNAME ?: 'null') .
            '; db=' . ($DB_NAME ?: 'null') .
            ($DB_PORT ? '; port=' . $DB_PORT : '') .
            ($DB_SOCKET ? '; socket=' . $DB_SOCKET : '') .
            '; err=' . $e->getMessage();
    }
    $conn = null;
}
