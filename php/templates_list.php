<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate'); header('Pragma: no-cache');

function respond($s, $p){ http_response_code($s); echo json_encode($p, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit; }

$category = ($_GET['category'] ?? '');
if (!in_array($category, ['agent','tcrei','design'], true)) {
  respond(400, ['ok'=>false,'error'=>'category must be agent|tcrei|design']);
}

$include_payload = isset($_GET['include_payload']) && $_GET['include_payload'] === '1';

if (!isset($conn) || !($conn instanceof mysqli)) {
  respond(500, ['ok'=>false,'error'=>'DB not connected']);
}
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
  $sql = "SELECT id, `key`, label, category, is_active, sort_order, version"
       . ($include_payload ? ", payload" : "")
       . " FROM prompt_templates WHERE category=? AND is_active=1 ORDER BY sort_order, label";
  $st  = $conn->prepare($sql);
  $st->bind_param('s', $category);
  $st->execute();
  $res = $st->get_result();
  $rows = [];
  while ($r = $res->fetch_assoc()) {
    if ($include_payload && isset($r['payload'])) {
      $r['payload'] = json_decode($r['payload'], true);
    }
    $rows[] = $r;
  }
  $st->close();
  respond(200, ['ok'=>true, 'templates'=>$rows]);
} catch (mysqli_sql_exception $e) {
  error_log('[TPL_LIST] '.$e->getMessage());
  respond(500, ['ok'=>false,'error'=>'Failed to list templates']);
}
