<?php
session_start();
require __DIR__ . '/db.php';

if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = $_POST['csrf_token'] ?? '';
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    $password2 = $_POST['password2'] ?? '';

    if (!hash_equals($_SESSION['csrf_token'], $token)) {
        $error = 'Token de seguridad inválido, recargá la página.';
    } elseif ($username === '' || $password === '') {
        $error = 'El usuario y la contraseña no pueden estar vacíos.';
    } elseif (strlen($username) < 3) {
        $error = 'El usuario debe tener al menos 3 caracteres.';
    } elseif (strlen($password) < 6) {
        $error = 'La contraseña debe tener al menos 6 caracteres.';
    } elseif ($password !== $password2) {
        $error = 'Las contraseñas no coinciden.';
    } else {
        try {
            $hash = password_hash($password, PASSWORD_BCRYPT);
            $stmt = $pdo->prepare('INSERT INTO app_usuarios (username, password_hash) VALUES (:u, :p)');
            $stmt->execute(['u' => $username, 'p' => $hash]);
            header('Location: login.php?registrado=1');
            exit;
        } catch (PDOException $e) {
            if ($e->getCode() === '23505') {
                $error = 'Ya existe un usuario con ese nombre.';
            } else {
                $error = 'Error al crear la cuenta: ' . htmlspecialchars($e->getMessage());
            }
        }
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Crear cuenta - SIGET</title>
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
        .links { text-align: center; margin-top: 1rem; font-size: .8rem; }
        .links a { color: #12324f; text-decoration: none; }
        .links a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="card">
        <h1>SIGET</h1>
        <p class="sub">Crear cuenta nueva</p>
        <?php if ($error): ?>
            <div class="error"><?= htmlspecialchars($error) ?></div>
        <?php endif; ?>
        <form method="post">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($_SESSION['csrf_token']) ?>">
            <label for="username">Usuario</label>
            <input type="text" id="username" name="username" required autofocus minlength="3" value="<?= htmlspecialchars($_POST['username'] ?? '') ?>">
            <label for="password">Contraseña</label>
            <input type="password" id="password" name="password" required minlength="6">
            <label for="password2">Repetir contraseña</label>
            <input type="password" id="password2" name="password2" required minlength="6">
            <button type="submit">Crear cuenta</button>
        </form>
        <div class="links">
            <a href="login.php">Volver al login</a>
        </div>
    </div>
</body>
</html>
