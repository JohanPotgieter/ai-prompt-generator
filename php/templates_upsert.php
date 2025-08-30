<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
function respond($s,$p){ http_response_code($s); echo json_encode($p, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit; }

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') respond(405, ['ok'=>false,'error'=>'POST only']);
$raw = file_get_contents('php://input'); if ($raw === false || $raw === '') respond(400, ['ok'=>false,'error'=>'Empty body']);
$data = json_decode($raw, true);
if (!is_array($data)) respond(400, ['ok'=>false,'error'=>'Invalid JSON']);

$category = trim((string)($data['category'] ?? ''));
$key      = trim((string)($data['key'] ?? ''));
$label    = trim((string)($data['label'] ?? ''));
$payload  = $data['payload'] ?? null;
$is_active= isset($data['is_active']) ? (int)!!$data['is_active'] : 1;
$sort     = isset($data['sort_order']) ? (int)$data['sort_order'] : 0;
$version  = isset($data['version']) ? (int)$data['version'] : 1;

if (!in_array($category, ['agent','tcrei','design'], true)) respond(400, ['ok'=>false,'error'=>'category must be agent|tcrei|design']);
if ($key === '' || $label === '' || !is_array($payload)) respond(400, ['ok'=>false,'error'=>'key, label, payload required']);

$payload_json = json_encode($payload, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
if ($payload_json === false) respond(400, ['ok'=>false,'error'=>'payload not JSON encodable']);

if (!isset($conn) || !($conn instanceof mysqli)) respond(500, ['ok'=>false,'error'=>'DB not connected']);
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
  $sql = "INSERT INTO prompt_templates (`category`,`key`,`label`,`payload`,`is_active`,`sort_order`,`version`)
          VALUES (?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE `label`=VALUES(`label`), `payload`=VALUES(`payload`),
                                  `is_active`=VALUES(`is_active`), `sort_order`=VALUES(`sort_order`),
                                  `version`=VALUES(`version`)";
  $st = $conn->prepare($sql);
  $st->bind_param('ssssiii', $category, $key, $label, $payload_json, $is_active, $sort, $version);
  $st->execute();
  $upserted_id = $conn->insert_id; // 0 if update path
  $st->close();
  respond(200, ['ok'=>true,'message'=>'Template upserted','id'=>$upserted_id]);
} catch (mysqli_sql_exception $e) {
  error_log('[TPL_UPSERT] '.$e->getMessage());
  respond(500, ['ok'=>false,'error'=>'Failed to upsert template']);
}
