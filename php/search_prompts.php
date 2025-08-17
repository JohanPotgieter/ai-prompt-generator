<?php
// php/search_prompts.php - prepared, sortable, LIKE/FULLTEXT, optional soft-delete

ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);
error_reporting(E_ALL);

require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    if (method_exists($conn, 'set_charset')) {
        $conn->set_charset('utf8mb4');
    }

    // --- Detect optional columns/indexes once ---
    $hasDeletedAt = false;
    $rs = $conn->query("SHOW COLUMNS FROM prompts LIKE 'deleted_at'");
    if ($rs && $rs->num_rows > 0) { $hasDeletedAt = true; $rs->close(); }

    // Try to detect a FULLTEXT index on (title, generated_prompt)
    $hasFulltext = false;
    $rs = $conn->query("SHOW INDEX FROM prompts WHERE Index_type='FULLTEXT'");
    if ($rs) {
        while ($idx = $rs->fetch_assoc()) {
            // crude but fine: any FULLTEXT on either field qualifies
            if (strtolower($idx['Column_name']) === 'title' || strtolower($idx['Column_name']) === 'generated_prompt') {
                $hasFulltext = true; break;
            }
        }
        $rs->close();
    }

    // --- Query params ---
    $type_filter  = isset($_GET['type']) ? trim((string)$_GET['type']) : 'All';
    $keyword      = isset($_GET['keyword']) ? trim((string)$_GET['keyword']) : '';
    $page         = isset($_GET['page']) ? (int)$_GET['page'] : 1;
    $limit        = isset($_GET['limit']) ? (int)$_GET['limit'] : 10;
    $sort_by      = isset($_GET['sort_by']) ? trim((string)$_GET['sort_by']) : 'created_at';
    $sort_dir     = isset($_GET['sort_dir']) ? strtolower(trim((string)$_GET['sort_dir'])) : 'desc';
    $search_mode  = isset($_GET['search_mode']) ? strtolower(trim((string)$_GET['search_mode'])) : 'auto'; // auto|like|fulltext
    $include_del  = isset($_GET['include_deleted']) ? (int)$_GET['include_deleted'] : 0;

    // Allowed filters
    $allowedTypes = ['All', 'tcrei', 'design'];
    if (!in_array($type_filter, $allowedTypes, true)) $type_filter = 'All';

    if ($limit <= 0 || $limit > 50) $limit = 10;
    if ($page < 1) $page = 1;
    $offset = ($page - 1) * $limit;
    if ($offset < 0) $offset = 0;

    // Cap keyword to avoid silly scans
    if (mb_strlen($keyword, 'UTF-8') > 200) {
        $keyword = mb_substr($keyword, 0, 200, 'UTF-8');
    }

    // Sorting whitelist
    $sortMap = [
        'created_at' => 'created_at',
        'title'      => 'title',
        'type'       => 'type'
    ];
    $orderCol = $sortMap[$sort_by] ?? 'created_at';
    $orderDir = ($sort_dir === 'asc') ? 'ASC' : 'DESC';

    // Decide search mode
    if ($search_mode === 'auto') {
        $useFulltext = $hasFulltext && $keyword !== '';
    } elseif ($search_mode === 'fulltext') {
        $useFulltext = $keyword !== '';
    } else {
        $useFulltext = false; // like
    }

    // --- WHERE builder ---
    $where = [];
    $types = '';
    $vals  = [];

    if ($hasDeletedAt && !$include_del) {
        $where[] = 'deleted_at IS NULL';
    }

    if ($type_filter !== 'All') {
        $where[] = 'type = ?';
        $types  .= 's';
        $vals[]  = $type_filter;
    }

    if ($keyword !== '') {
        if ($useFulltext) {
            // FULLTEXT — boolean mode for flexibility
            $where[] = 'MATCH(title, generated_prompt) AGAINST (? IN BOOLEAN MODE)';
            $types  .= 's';
            // Simple transform: split words into +word* tokens (prefix match); keep quotes
            $kw = trim(preg_replace('/\s+/', ' ', $keyword));
            // Convert to boolean query: +term* +term* ...
            $terms = preg_split('/\s+/', $kw);
            $bool = implode(' ', array_map(function($t){
                // Keep quoted phrases as-is; otherwise prefix with + and suffix with *
                if (preg_match('/^".+"$/', $t)) return $t;
                // strip dangerous chars
                $t = preg_replace('/[^\p{L}\p{N}_-]+/u', '', $t);
                if ($t === '') return '';
                return '+' . $t . '*';
            }, $terms));
            $bool = trim(preg_replace('/\s+/', ' ', $bool));
            if ($bool === '') $bool = $kw; // fallback
            $vals[] = $bool;
        } else {
            // LIKE
            $where[] = '(title LIKE ? OR generated_prompt LIKE ?)';
            $types  .= 'ss';
            $like = '%' . $keyword . '%';
            $vals[] = $like;
            $vals[] = $like;
        }
    }

    $whereSql = $where ? (' WHERE ' . implode(' AND ', $where)) : '';

    // --- COUNT ---
    $countSql = "SELECT COUNT(*) AS total FROM prompts {$whereSql}";
    $stmtCnt  = $conn->prepare($countSql);
    if ($types !== '') $stmtCnt->bind_param($types, ...$vals);
    $stmtCnt->execute();
    $resCnt = $stmtCnt->get_result();
    $total_prompts = (int)($resCnt->fetch_assoc()['total'] ?? 0);
    $stmtCnt->close();

    $total_pages = ($total_prompts > 0) ? (int)ceil($total_prompts / $limit) : 0;
    if ($total_pages === 0) {
        echo json_encode([
            'total_prompts' => 0,
            'per_page'      => $limit,
            'current_page'  => 1,
            'total_pages'   => 0,
            'prompts'       => []
        ]);
        $conn->close();
        exit();
    }
    if ($page > $total_pages) {
        $page = $total_pages;
        $offset = ($page - 1) * $limit;
    }

    // --- SELECT data (bind limit/offset as ints) ---
    $dataSql = "SELECT id, type, title, generated_prompt, prompt_data, created_at
                FROM prompts
                {$whereSql}
                ORDER BY {$orderCol} {$orderDir}
                LIMIT ? OFFSET ?";
    $stmtData = $conn->prepare($dataSql);

    $typesData = $types . 'ii';
    $valsData  = $vals;
    $valsData[] = $limit;
    $valsData[] = $offset;

    $stmtData->bind_param($typesData, ...$valsData);
    $stmtData->execute();
    $res = $stmtData->get_result();

    $prompts = [];
    while ($row = $res->fetch_assoc()) {
        $decoded = json_decode($row['prompt_data'], true);
        $row['prompt_data'] = (json_last_error() === JSON_ERROR_NONE) ? $decoded : [];
        $prompts[] = $row;
    }
    $stmtData->close();

    echo json_encode([
        'total_prompts' => $total_prompts,
        'per_page'      => $limit,
        'current_page'  => $page,
        'total_pages'   => $total_pages,
        'prompts'       => $prompts
    ]);

} catch (mysqli_sql_exception $e) {
    error_log('ERROR (search_prompts): ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Failed to search prompts']);
} finally {
    if ($conn) { $conn->close(); }
}

?>