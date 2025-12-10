import express from 'express';

const app = express();
const PORT = 3457;

// 测试资源
const testResources = {
  '/test-image.png': {
    content: Buffer.from('fake-png-data'),
    contentType: 'image/png',
    size: 14
  },
  '/test-file.txt': {
    content: Buffer.from('Hello, world!'),
    contentType: 'text/plain',
    size: 13
  }
};

app.get('*', (req, res) => {
  const resource = testResources[req.path];

  if (!resource) {
    res.status(404).send('Not Found');
    return;
  }

  res.setHeader('Content-Type', resource.contentType);
  res.setHeader('Content-Length', resource.size);
  res.send(resource.content);
});

app.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
});
