<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
function respond($s,$p){ http_response_code($s); echo json_encode($p, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit; }

$id  = isset($_GET['id'])  ? (int)$_GET['id'] : null;
$key = $_GET['key'] ?? null;
$category = $_GET['category'] ?? null;

if (!$id && !($key && $category)) {
  respond(400, ['ok'=>false,'error'=>'Provide id OR (category + key)']);
}
if ($key && !in_array($category, ['agent','tcrei','design'], true)) {
  respond(400, ['ok'=>false,'error'=>'Invalid category']);
}

if (!isset($conn) || !($conn instanceof mysqli)) respond(500, ['ok'=>false,'error'=>'DB not connected']);
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
  if ($id) {
    $st = $conn->prepare("SELECT id, `key`, label, category, payload, is_active, sort_order, version FROM prompt_templates WHERE id=? LIMIT 1");
    $st->bind_param('i', $id);
  } else {
    $st = $conn->prepare("SELECT id, `key`, label, category, payload, is_active, sort_order, version FROM prompt_templates WHERE category=? AND `key`=? LIMIT 1");
    $st->bind_param('ss', $category, $key);
  }
  $st->execute();
  $r = $st->get_result()->fetch_assoc();
  $st->close();
  if (!$r) respond(404, ['ok'=>false,'error'=>'Not found']);
  $r['payload'] = json_decode($r['payload'], true);
  respond(200, ['ok'=>true,'template'=>$r]);
} catch (mysqli_sql_exception $e) {
  error_log('[TPL_GET] '.$e->getMessage());
  respond(500, ['ok'=>false,'error'=>'Failed to get template']);
}
