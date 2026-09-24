<?php
session_start();
require __DIR__ . '/db.php';

if (empty($_SESSION['user_id'])) {
    header('Location: login.php');
    exit;
}

if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

$mensaje = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = $_POST['csrf_token'] ?? '';
    if (!hash_equals($_SESSION['csrf_token'], $token)) {
        $error = 'Token de seguridad inválido, recargá la página.';
    } elseif (($_POST['accion'] ?? '') === 'crear') {
        $nuevo_usuario = trim($_POST['nuevo_usuario'] ?? '');
        $nueva_password = $_POST['nueva_password'] ?? '';

        if ($nuevo_usuario === '' || $nueva_password === '') {
            $error = 'El usuario y la contraseña no pueden estar vacíos.';
        } elseif (strlen($nueva_password) < 6) {
            $error = 'La contraseña debe tener al menos 6 caracteres.';
        } else {
            try {
                $hash = password_hash($nueva_password, PASSWORD_BCRYPT);
                $stmt = $pdo->prepare('INSERT INTO app_usuarios (username, password_hash) VALUES (:u, :p)');
                $stmt->execute(['u' => $nuevo_usuario, 'p' => $hash]);
                $mensaje = "Usuario \"$nuevo_usuario\" creado correctamente.";
            } catch (PDOException $e) {
                if ($e->getCode() === '23505') {
                    $error = 'Ya existe un usuario con ese nombre.';
                } else {
                    $error = 'Error al crear el usuario: ' . htmlspecialchars($e->getMessage());
                }
            }
        }
    } elseif (($_POST['accion'] ?? '') === 'eliminar') {
        $id = (int)($_POST['id'] ?? 0);
        if ($id === (int)$_SESSION['user_id']) {
            $error = 'No podés eliminar el usuario con el que estás logueado.';
        } else {
            $stmt = $pdo->prepare('DELETE FROM app_usuarios WHERE id = :id');
            $stmt->execute(['id' => $id]);
            $mensaje = 'Usuario eliminado correctamente.';
        }
    }
}

$usuarios = $pdo->query('SELECT id, username, creado_en FROM app_usuarios ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>SIGET — Gestión de usuarios</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #f4f6f8; margin: 0; color: #1a1a1a; }
        header { background: #12324f; color: #fff; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        header h1 { font-size: 1.1rem; margin: 0; }
        header a { color: #cfe3f7; text-decoration: none; font-size: .85rem; }
        main { max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
        .panel { background: #fff; border-radius: 10px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,.08); margin-bottom: 1.5rem; }
        .panel h2 { font-size: 1rem; margin-top: 0; color: #12324f; }
        label { display: block; font-size: .85rem; margin-bottom: .3rem; }
        input { padding: .5rem; border: 1px solid #ccc; border-radius: 6px; margin-bottom: .8rem; width: 100%; box-sizing: border-box; }
        button { padding: .5rem 1rem; background: #12324f; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
        button.danger { background: #a4262c; padding: .35rem .7rem; font-size: .8rem; }
        table { width: 100%; border-collapse: collapse; font-size: .9rem; }
        th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #eee; }
        .msg { padding: .6rem; border-radius: 6px; margin-bottom: 1rem; font-size: .85rem; }
        .msg.ok { background: #e6f4ea; color: #1e6b34; }
        .msg.error { background: #fde8e8; color: #a4262c; }
        form.inline { display: inline; }
    </style>
</head>
<body>
    <header>
        <h1>SIGET — Sistema de Gestión y Trazabilidad</h1>
        <a href="logout.php">Salir (<?= htmlspecialchars($_SESSION['username']) ?>)</a>
    </header>
    <main>
        <?php if ($mensaje): ?><div class="msg ok"><?= htmlspecialchars($mensaje) ?></div><?php endif; ?>
        <?php if ($error): ?><div class="msg error"><?= htmlspecialchars($error) ?></div><?php endif; ?>

        <div class="panel">
            <h2>Crear usuario</h2>
            <form method="post">
                <input type="hidden" name="accion" value="crear">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($_SESSION['csrf_token']) ?>">
                <label for="nuevo_usuario">Usuario</label>
                <input type="text" id="nuevo_usuario" name="nuevo_usuario" required>
                <label for="nueva_password">Contraseña</label>
                <input type="password" id="nueva_password" name="nueva_password" required minlength="6">
                <button type="submit">Crear usuario</button>
            </form>
        </div>

        <div class="panel">
            <h2>Usuarios registrados</h2>
            <table>
                <thead>
                    <tr><th>ID</th><th>Usuario</th><th>Creado</th><th>Acción</th></tr>
                </thead>
                <tbody>
                    <?php foreach ($usuarios as $u): ?>
                    <tr>
                        <td><?= (int)$u['id'] ?></td>
                        <td><?= htmlspecialchars($u['username']) ?></td>
                        <td><?= htmlspecialchars($u['creado_en']) ?></td>
                        <td>
                            <form class="inline" method="post" onsubmit="return confirm('¿Eliminar este usuario?');">
                                <input type="hidden" name="accion" value="eliminar">
                                <input type="hidden" name="id" value="<?= (int)$u['id'] ?>">
                                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($_SESSION['csrf_token']) ?>">
                                <button type="submit" class="danger">Eliminar</button>
                            </form>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </main>
</body>
</html>
