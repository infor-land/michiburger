const canvas = document.getElementById("juego");
const ctx = canvas.getContext("2d");

let jugador = { x: 400, y: 300, w: 50, h: 50, color: "#FF1493" };
let objetivo = generarObjetivo();
let enemigo = { x: Math.random()*800, y: Math.random()*600, r: 25, color: "red", velocidad: 0.5 };

let colisiones = 0;
let vidas = 3;
let golpesRecibidos = 0;
let golpesParaPerderVida = 5;

let ultimoGolpe = Date.now(); // Tiempo del último golpe en milisegundos


let teclas = {};

document.addEventListener("keydown", e => teclas[e.key] = true);
document.addEventListener("keyup", e => teclas[e.key] = false);

function generarObjetivo() {
  return {
    x: Math.random() * (canvas.width - 50),
    y: Math.random() * (canvas.height - 50),
    w: 50,
    h: 50,
    color: `rgb(${rand()},${rand()},${rand()})`
  };
}

function rand() {
  return Math.floor(Math.random() * 205 + 50);
}

function moverJugador() {
  if (teclas["ArrowLeft"] && jugador.x > 0) jugador.x -= 2;
  if (teclas["ArrowRight"] && jugador.x + jugador.w < canvas.width) jugador.x += 2;
  if (teclas["ArrowUp"] && jugador.y > 0) jugador.y -= 2;
  if (teclas["ArrowDown"] && jugador.y + jugador.h < canvas.height) jugador.y += 2;
}

function moverEnemigo() {
  let dx = jugador.x + jugador.w/2 - enemigo.x;
  let dy = jugador.y + jugador.h/2 - enemigo.y;
  let dist = Math.hypot(dx, dy);
  enemigo.x += (dx / dist) * enemigo.velocidad;
  enemigo.y += (dy / dist) * enemigo.velocidad;
}

function detectarColisiones() {
  
  let ahora = Date.now(); // Tiempo actual
  // Jugador vs Objetivo
  if (jugador.x < objetivo.x + objetivo.w &&
      jugador.x + jugador.w > objetivo.x &&
      jugador.y < objetivo.y + objetivo.h &&
      jugador.y + jugador.h > objetivo.y) {
    objetivo = generarObjetivo();
    colisiones++;
    enemigo.velocidad += 0.1;
  }

  // Jugador vs Enemigo
  let dx = jugador.x + jugador.w/2 - enemigo.x;
  let dy = jugador.y + jugador.h/2 - enemigo.y;
  let dist = Math.hypot(dx, dy);
  if (dist < enemigo.r + jugador.w/2) {
    if (ahora - ultimoGolpe > 1500) { // 1.5 segundos de espera
		golpesRecibidos++;
		ultimoGolpe = ahora;
	
		if (golpesRecibidos >= golpesParaPerderVida) {
		  vidas--;
		  golpesRecibidos = 0;
		}
	}
  }
}

function dibujar() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Jugador
  ctx.fillStyle = jugador.color;
  ctx.fillRect(jugador.x, jugador.y, jugador.w, jugador.h);

  // Objetivo
  ctx.fillStyle = objetivo.color;
  ctx.fillRect(objetivo.x, objetivo.y, objetivo.w, objetivo.h);

  // Enemigo
  ctx.fillStyle = enemigo.color;
  ctx.beginPath();
  ctx.arc(enemigo.x, enemigo.y, enemigo.r, 0, Math.PI * 2);
  ctx.fill();

  // Vidas
  ctx.fillStyle = "black";
  ctx.font = "20px Arial";
  ctx.fillText(`Vidas: ${vidas}`, 10, 20);
  ctx.fillText(`Colisiones: ${colisiones}`, 10, 40);
  ctx.fillText(`Golpes recibidos: ${golpesRecibidos}`, 10, 60);

  if (vidas <= 0) {
    ctx.fillStyle = "red";
    ctx.font = "40px Arial";
    ctx.fillText("GAME OVER", canvas.width/2 - 100, canvas.height/2);
  }
}

function loop() {
  if (vidas > 0) {
    moverJugador();
    moverEnemigo();
    detectarColisiones();
  }
  dibujar();
  requestAnimationFrame(loop);
}

loop();
