<?php
session_start();
require __DIR__ . '/db.php';

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    $stmt = $pdo->prepare('SELECT id, username, password_hash FROM app_usuarios WHERE username = :username');
    $stmt->execute(['username' => $username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($user && password_verify($password, $user['password_hash'])) {
        session_regenerate_id(true);
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['username'] = $user['username'];
        header('Location: dashboard.php');
        exit;
    } else {
        $error = 'Usuario o contraseña incorrectos.';
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Ingresar - SIGET</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #0f1f33; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #fff; padding: 2.5rem; border-radius: 10px; width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,.3); }
        h1 { font-size: 1.3rem; margin-bottom: .3rem; color: #12324f; }
        p.sub { color: #667; margin-top: 0; margin-bottom: 1.5rem; font-size: .85rem; }
        label { display: block; font-size: .85rem; margin-bottom: .3rem; color: #333; }
        input { width: 100%; padding: .6rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; padding: .7rem; background: #12324f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem; }
        button:hover { background: #1c4a72; }
        .error { background: #fde8e8; color: #a4262c; padding: .6rem; border-radius: 6px; margin-bottom: 1rem; font-size: .85rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1>SIGET</h1>
        <p class="sub">Sistema de Gestión y Trazabilidad</p>
        <?php if ($error): ?>
            <div class="error"><?= htmlspecialchars($error) ?></div>
        <?php endif; ?>
        <form method="post">
            <label for="username">Usuario</label>
            <input type="text" id="username" name="username" required autofocus>
            <label for="password">Contraseña</label>
            <input type="password" id="password" name="password" required>
            <button type="submit">Ingresar</button>
        </form>
    </div>
</body>
</html>
