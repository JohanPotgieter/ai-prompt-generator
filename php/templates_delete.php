<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
function respond($s,$p){ http_response_code($s); echo json_encode($p, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit; }

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') respond(405, ['ok'=>false,'error'=>'POST only']);
$data = json_decode(file_get_contents('php://input') ?: '[]', true);
$id  = isset($data['id'])  ? (int)$data['id'] : null;
$key = $data['key'] ?? null; $category = $data['category'] ?? null;

if (!$id && !($key && $category)) respond(400, ['ok'=>false,'error'=>'Provide id OR (category + key)']);

if (!isset($conn) || !($conn instanceof mysqli)) respond(500, ['ok'=>false,'error'=>'DB not connected']);
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
  if ($id) {
    $st = $conn->prepare("UPDATE prompt_templates SET is_active=0 WHERE id=?");
    $st->bind_param('i', $id);
  } else {
    $st = $conn->prepare("UPDATE prompt_templates SET is_active=0 WHERE category=? AND `key`=?");
    $st->bind_param('ss', $category, $key);
  }
  $st->execute(); $aff = $st->affected_rows; $st->close();
  respond(200, ['ok'=>true,'message'=>'Template deleted (soft)','affected'=>$aff]);
} catch (mysqli_sql_exception $e) {
  error_log('[TPL_DELETE] '.$e->getMessage());
  respond(500, ['ok'=>false,'error'=>'Failed to delete template']);
}
