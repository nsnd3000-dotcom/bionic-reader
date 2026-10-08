"""带 no-cache 头的本地静态服务。

为什么不用 `python -m http.server`：
它不发任何缓存控制头，浏览器会按启发式规则缓存 index.html。
于是"改完代码 → 刷新页面 → 没变化"会反复发生，
让人误以为改动没生效（或者改错了地方），白白浪费一轮排查。

这里对每个响应都加：
    Cache-Control: no-store, no-cache, must-revalidate
    Pragma: no-cache
    Expires: 0
刷新即拿到最新文件，不需要 Ctrl+F5。
"""
import sys
import os
import functools
import http.server
import socketserver

HERE = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 只打印出错，避免每次请求刷屏
        if args and str(args[1]).startswith(('4', '5')):
            sys.stderr.write("  %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(NoCacheHandler, directory=HERE)
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(('127.0.0.1', port), handler) as httpd:
            print("  服务已就绪（no-cache）：http://localhost:%d/" % port)
            print("  按 Ctrl+C 或关闭窗口停止。")
            httpd.serve_forever()
    except OSError as e:
        print("  端口 %d 启动失败：%s" % (port, e))
        return 1
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
