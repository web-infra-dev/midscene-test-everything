#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>
#include <util.h>

/* Give UxPlay's logs a terminal so libc flushes each line. Video remains on fd 3.
 * No shell or third-party PTY dependency; signals are forwarded to the receiver. */
static volatile sig_atomic_t receiver = -1;
static void forward_signal(int signal_number) {
    if (receiver > 0) {
        int forwarded = signal_number == SIGALRM ? SIGKILL : signal_number;
        if (kill(-(pid_t)receiver, forwarded) < 0) kill((pid_t)receiver, forwarded);
        if (signal_number == SIGTERM || signal_number == SIGINT) alarm(1);
    }
}

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    int master, slave;
    if (openpty(&master, &slave, NULL, NULL, NULL) < 0) {
        perror("AirPlay log terminal");
        return 1;
    }
    signal(SIGTERM, forward_signal);
    signal(SIGINT, forward_signal);
    signal(SIGALRM, forward_signal);
    receiver = fork();
    if (receiver < 0) { perror("AirPlay fork"); return 1; }
    if (receiver == 0) {
        signal(SIGTERM, SIG_DFL);
        signal(SIGINT, SIG_DFL);
        signal(SIGALRM, SIG_DFL);
        setpgid(0, 0);
        close(master);
        if (dup2(slave, STDOUT_FILENO) < 0 || dup2(slave, STDERR_FILENO) < 0) _exit(126);
        close(slave);
        execvp(argv[1], argv + 1);
        perror("AirPlay receiver exec");
        _exit(127);
    }
    setpgid((pid_t)receiver, (pid_t)receiver);
    close(slave);
    close(3);
    char buffer[8192];
    ssize_t length;
    while (1) {
        length = read(master, buffer, sizeof(buffer));
        if (length < 0 && errno == EINTR) continue;
        if (length <= 0) break;
        ssize_t offset = 0;
        while (offset < length) {
            ssize_t written = write(STDOUT_FILENO, buffer + offset, (size_t)(length - offset));
            if (written < 0 && errno == EINTR) continue;
            if (written <= 0) { kill((pid_t)receiver, SIGTERM); break; }
            offset += written;
        }
    }
    close(master);
    int status = 0;
    while (waitpid((pid_t)receiver, &status, 0) < 0 && errno == EINTR) {}
    return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
