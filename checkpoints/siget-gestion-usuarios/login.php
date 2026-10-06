<?php
session_start();
require __DIR__ . '/db.php';

$error = '';
$mensaje = '';

if (isset($_GET['registrado'])) {
    $mensaje = 'Cuenta creada correctamente. Ya podés ingresar.';
} elseif (isset($_GET['reset_ok'])) {
    $mensaje = 'Contraseña restablecida correctamente. Ya podés ingresar.';
}

const MAX_INTENTOS = 3;
const MINUTOS_BLOQUEO = 5;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    // La comparación de fecha/hora se hace en PostgreSQL (now()), no en PHP:
    // evita desajustes por zona horaria entre el servidor web y la base de datos.
    $stmt = $pdo->prepare(
        'SELECT id, username, password_hash, intentos_fallidos,
                (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > now()) AS bloqueado,
                CEIL(EXTRACT(EPOCH FROM (bloqueado_hasta - now())) / 60) AS minutos_restantes
         FROM app_usuarios WHERE username = :username'
    );
    $stmt->execute(['username' => $username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    // PDO_PGSQL devuelve BOOLEAN de Postgres como bool nativo de PHP (no como 't'/'f').
    $bloqueado = $user && $user['bloqueado'] === true;

    if ($bloqueado) {
        $minutosRestantes = (int) $user['minutos_restantes'];
        $error = "Acceso denegado: cuenta bloqueada por demasiados intentos fallidos. Probá de nuevo en {$minutosRestantes} minuto(s).";
    } elseif ($user && password_verify($password, $user['password_hash'])) {
        // Login correcto: resetea el contador de intentos.
        $reset = $pdo->prepare('UPDATE app_usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = :id');
        $reset->execute(['id' => $user['id']]);

        session_regenerate_id(true);
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['username'] = $user['username'];
        header('Location: dashboard.php');
        exit;
    } elseif ($user) {
        // Usuario existe pero la contraseña es incorrecta: suma un intento fallido.
        $nuevosIntentos = $user['intentos_fallidos'] + 1;

        if ($nuevosIntentos >= MAX_INTENTOS) {
            $bloquear = $pdo->prepare("UPDATE app_usuarios SET intentos_fallidos = :i, bloqueado_hasta = now() + interval '" . MINUTOS_BLOQUEO . " minutes' WHERE id = :id");
            $bloquear->execute(['i' => $nuevosIntentos, 'id' => $user['id']]);
            $error = 'Acceso denegado: superaste el máximo de ' . MAX_INTENTOS . ' intentos. Cuenta bloqueada por ' . MINUTOS_BLOQUEO . ' minutos.';
        } else {
            $actualizar = $pdo->prepare('UPDATE app_usuarios SET intentos_fallidos = :i WHERE id = :id');
            $actualizar->execute(['i' => $nuevosIntentos, 'id' => $user['id']]);
            $restantes = MAX_INTENTOS - $nuevosIntentos;
            $error = "Acceso denegado: usuario o contraseña incorrectos. Te queda(n) {$restantes} intento(s).";
        }
    } else {
        // Usuario no existe: mismo mensaje genérico, sin revelar qué usuarios existen.
        $error = 'Acceso denegado: usuario o contraseña incorrectos.';
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
        .ok { background: #e6f4ea; color: #1e6b34; padding: .6rem; border-radius: 6px; margin-bottom: 1rem; font-size: .85rem; }
        .links { display: flex; justify-content: space-between; margin-top: 1rem; font-size: .8rem; }
        .links a { color: #12324f; text-decoration: none; }
        .links a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="card">
        <h1>SIGET</h1>
        <p class="sub">Sistema de Gestión y Trazabilidad</p>
        <?php if ($mensaje): ?>
            <div class="ok"><?= htmlspecialchars($mensaje) ?></div>
        <?php endif; ?>
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
        <div class="links">
            <a href="register.php">Crear cuenta</a>
            <a href="reset-password.php">Olvidé mi contraseña</a>
        </div>
    </div>
</body>
</html>
